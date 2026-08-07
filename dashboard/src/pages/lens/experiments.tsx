import { lensErrorMessage } from '@/pages/lens/lens-error';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Badge, Button, Card, Checkbox, DataTable, type DataTableColumn, EmptyState, Input, Label, PageShell, Select, Textarea } from '@usetheo/ui';
import { AppModal } from '@/components/ui/app-modal';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/http/api';
import { formatCost, formatDuration, formatScore, formatTokens, shortId } from '@/lib/formatting/format';
import { TracePeekSheet } from './traces/peek-sheet';

/**
 * M64 — /observability/experiments. Run a regression dataset × a variant (model/prompt override)
 * through the M33 provider path and inspect per-row output + evaluator scores; compare two+ runs
 * side-by-side (per-row score delta + aggregate pass-rate delta). "View Trace" opens the source span
 * detail (M58 Sheet). A `?datasetId=` seeds a run form; `?compare=id,id` opens the compare view. Every
 * write is Principal-scoped upstream; a provider/scope error fails closed to a typed Alert.
 */

interface RunScore {
  name: string;
  score?: number;
  label?: string;
}
interface RunItem {
  datasetItemTraceId: string;
  output?: string;
  totalTokens: number;
  costUsd?: number;
  latencyMs: number;
  model: string;
  scores: RunScore[];
  error?: string;
}
interface ExperimentRun {
  id: string;
  datasetId: string;
  name: string;
  variant: { model?: string; promptOverride?: string };
  status: 'completed' | 'partial' | 'failed';
  truncated: boolean;
  itemCount: number;
  passCount: number;
  avgScore?: number;
  totalCostUsd: number;
  createdAt: string;
  items?: RunItem[];
}
/** The signed aggregate deltas the compare API returns (A minus B); score/latency null when absent. */
interface RunCompareDeltas {
  passCountDelta: number;
  passRateDelta: number;
  avgScoreDelta: number | null;
  totalCostDelta: number;
  avgLatencyDelta: number | null;
}

/** Mean of a row's numeric scores, or undefined when the row has none (mirrors the domain `rowMeanScore`). */
function rowMeanScore(item: RunItem): number | undefined {
  const nums = item.scores.map((s) => s.score).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined;
}

/** A signed delta rendered as a badge (+/-, fixed dp); null → em-dash (never fabricated). */
function DeltaBadge({ value, dp = 2, prefix = '' }: { value: number | null; dp?: number; prefix?: string }) {
  if (value === null) return <span className="text-xs text-muted-foreground">—</span>;
  const sign = value >= 0 ? '+' : '';
  return (
    <Badge variant={value >= 0 ? 'default' : 'outline'}>
      {prefix}
      {sign}
      {value.toFixed(dp)}
    </Badge>
  );
}

function errorMessage(err: unknown): string {
  return lensErrorMessage(
    err,
    {
      503: 'The provider is not configured — a run needs a provider.',
      429: 'Rate limit reached — wait a moment before running again.',
      403: 'You do not have permission to run experiments in this workspace.',
      404: 'The dataset is not available (it may belong to another workspace).',
    },
    'Could not run the experiment — try again shortly.',
  );
}

/** A single run's aggregate summary line. */
function RunSummary({ run }: { run: ExperimentRun }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs" data-testid="run-summary">
      <Badge variant={run.status === 'completed' ? 'default' : 'outline'}>{run.status}</Badge>
      <span>
        {run.passCount} / {run.itemCount} passed
      </span>
      {run.avgScore !== undefined ? <Badge variant="outline">avg {formatScore(run.avgScore)}</Badge> : null}
      <Badge variant="outline">{formatCost(run.totalCostUsd)}</Badge>
      {run.truncated ? <Badge variant="outline">truncated</Badge> : null}
    </div>
  );
}

export function LensExperimentsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Experiments'), [setPageTitle]);
  useRequireAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const datasetId = params.get('datasetId') ?? '';
  const compareIds = (params.get('compare') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  // Run is a centered modal (AppModal): a dataset picker + variant overrides — replaces the two former
  // inline Cards. Auto-opens once when arriving with `?datasetId=` (the "Run experiment" link from Datasets).
  const [runOpen, setRunOpen] = useState(Boolean(datasetId));
  const [runDatasetId, setRunDatasetId] = useState(datasetId);
  const [viewTrace, setViewTrace] = useState<string | null>(null);
  // Compare-picker: select exactly two runs, then open the side-by-side compare via `?compare=`.
  const [picked, setPicked] = useState<string[]>([]);
  const togglePick = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 2 ? [...cur, id] : cur));

  // M73 — the datasets a run can be started from, so the bare Experiments page is self-serve (not a
  // dead-end that only works via `?datasetId=` from Traces). Reuses the existing datasets read (Rule 9).
  const datasetsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/datasets'] as const,
    queryFn: () => cloudFetch<{ datasets: { id: string; name: string }[] }>('/v1/dashboard/lens/datasets', {}, { throwOnError: true }),
    // The run modal's dataset picker needs the list whenever we're not in the compare view.
    enabled: compareIds.length < 2,
  });
  const datasets = datasetsQuery.data?.datasets ?? [];

  // Runs list (or dataset-filtered when arriving from "create regression dataset").
  const runsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/experiment-runs', datasetId] as const,
    queryFn: () =>
      cloudFetch<{ runs: ExperimentRun[] }>(`/v1/dashboard/lens/experiment-runs${datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : ''}`, {}, { throwOnError: true }),
    enabled: compareIds.length < 2,
  });

  // Compare view: two+ runs (with items) aligned by source trace id.
  const compareQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/experiment-runs/compare', compareIds.join(',')] as const,
    queryFn: () => cloudFetch<{ runs: ExperimentRun[]; deltas: RunCompareDeltas | null }>(`/v1/dashboard/lens/experiment-runs/compare?ids=${encodeURIComponent(compareIds.join(','))}`, {}, { throwOnError: true }),
    enabled: compareIds.length >= 2,
  });

  const run = useMutation({
    mutationFn: () =>
      cloudFetch<ExperimentRun>(
        '/v1/dashboard/lens/experiment-runs',
        {
          method: 'POST',
          body: JSON.stringify({
            datasetId: runDatasetId,
            variant: { ...(model.trim() ? { model: model.trim() } : {}), ...(prompt.trim() ? { promptOverride: prompt.trim() } : {}) },
          }),
        },
        { throwOnError: true },
      ),
    retry: false,
    onSuccess: () => {
      setRunOpen(false);
      void qc.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/experiment-runs'] });
    },
  });
  const latest = run.data ?? null;

  /**
   * The per-row columns. When `baseline` is passed (the compare view's second+ run), a "Δ vs A" column
   * shows this row's mean-score delta against the baseline run aligned by source trace (DoD3 per-row delta).
   */
  const makeItemColumns = (baseline?: Map<string, number | undefined>): DataTableColumn<RunItem>[] => {
    const cols: DataTableColumn<RunItem>[] = [
      { key: 'traceId', label: 'Trace', render: (row) => <span className="font-mono text-xs">{shortId(row.datasetItemTraceId)}</span> },
      {
        key: 'output',
        label: 'Output',
        render: (row) =>
          row.error ? <span className="text-destructive text-xs">error: {row.error}</span> : <span className="text-xs">{row.output ?? '—'}</span>,
      },
      {
        key: 'scores',
        label: 'Score',
        render: (row) => (
          <div className="flex gap-1">
            {row.scores.map((s) => {
              // An un-evaluated row has neither a label nor a score → em-dash, NOT a fabricated `0.00`
              // (issue #177). The accent (pass) is claimed ONLY when the evaluator itself labelled it
              // "pass" — a raw numeric score stays neutral (no fabricated 0.5 pass threshold).
              const evaluated = s.label !== undefined || s.score !== undefined;
              const passing = s.label?.toLowerCase() === 'pass';
              const shown = evaluated ? (s.label ?? formatScore(s.score)) : '—';
              return (
                <Badge key={s.name} variant={passing ? 'default' : 'outline'}>
                  {s.name}: {shown}
                </Badge>
              );
            })}
          </div>
        ),
      },
      { key: 'metrics', label: 'Cost / latency', render: (row) => <span className="text-xs text-muted-foreground">{formatCost(row.costUsd ?? NaN)} · {formatDuration(row.latencyMs)} · {formatTokens(row.totalTokens)} tok</span> },
      { key: 'view', label: '', render: (row) => <Button variant="ghost" size="sm" onClick={() => setViewTrace(row.datasetItemTraceId)}>View trace</Button> },
    ];
    if (baseline) {
      cols.splice(3, 0, {
        key: 'scoreDelta',
        label: 'Δ vs A',
        render: (row) => {
          const mine = rowMeanScore(row);
          const base = baseline.get(row.datasetItemTraceId);
          return <DeltaBadge value={typeof mine === 'number' && typeof base === 'number' ? mine - base : null} />;
        },
      });
    }
    return cols;
  };
  const itemColumns = makeItemColumns();

  // Compare view — two+ runs side-by-side + the aggregate deltas (pass-rate/score/cost) + per-row score delta.
  if (compareIds.length >= 2) {
    const runs = compareQuery.data?.runs ?? [];
    const deltas = compareQuery.data?.deltas ?? null;
    const baseline = new Map<string, number | undefined>((runs[0]?.items ?? []).map((it) => [it.datasetItemTraceId, rowMeanScore(it)]));
    return (
      <PageShell title="Compare runs" description="Two experiment runs side-by-side, aligned by source trace.">
        {compareQuery.isError ? (
          <Alert intent="warning" title="Could not load the comparison" description="Try again shortly." />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm" data-testid="passrate-delta">
              <span className="flex items-center gap-1">Pass-rate Δ (A−B): <DeltaBadge value={deltas ? deltas.passRateDelta : null} /></span>
              <span className="flex items-center gap-1">Avg-score Δ: <DeltaBadge value={deltas ? deltas.avgScoreDelta : null} /></span>
              <span className="flex items-center gap-1">Cost Δ: <DeltaBadge value={deltas ? deltas.totalCostDelta : null} dp={4} prefix="$" /></span>
            </div>
            <div className="flex gap-3 overflow-x-auto">
              {runs.map((r, i) => (
                <Card key={r.id} className="w-[460px] shrink-0">
                  <Card.Body className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{i === 0 ? 'A · ' : i === 1 ? 'B · ' : ''}{r.name}</span>
                      {r.variant.model ? <Badge variant="outline">{r.variant.model}</Badge> : null}
                    </div>
                    <RunSummary run={r} />
                    <DataTable data={r.items ?? []} columns={i === 0 ? itemColumns : makeItemColumns(baseline)} rowKey={(row) => row.datasetItemTraceId} />
                  </Card.Body>
                </Card>
              ))}
            </div>
          </>
        )}
        <TracePeekSheet traceId={viewTrace} onClose={() => setViewTrace(null)} />
      </PageShell>
    );
  }

  const runs = runsQuery.data?.runs ?? [];
  return (
    <PageShell
      title="Experiments"
      description="Run a regression dataset against a variant and compare runs."
      primaryAction={{
        label: 'New run',
        icon: Plus,
        onClick: () => {
          setRunDatasetId(datasetId || runDatasetId);
          setRunOpen(true);
        },
      }}
    >
      {/* The latest run's result renders inline (tabular output, not a form — the run FORM is the modal). */}
      {latest ? (
        <Card className="mb-4">
          <Card.Body className="space-y-2" data-testid="latest-run">
            <span className="text-xs font-semibold uppercase text-muted-foreground">Latest run</span>
            <RunSummary run={latest} />
            <DataTable data={latest.items ?? []} columns={itemColumns} rowKey={(row) => row.datasetItemTraceId} />
          </Card.Body>
        </Card>
      ) : null}

      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase text-muted-foreground">Recent runs</span>
        {picked.length > 0 ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={picked.length !== 2}
            onClick={() => setParams({ compare: picked.join(',') })}
          >
            Compare selected ({picked.length}/2)
          </Button>
        ) : null}
      </div>
      {runsQuery.isError ? (
        <Alert intent="warning" title="Could not load runs" description="Try again shortly." />
      ) : runs.length === 0 ? (
        <EmptyState title="No runs yet" description="Create a regression dataset from the traces list, then run it here." />
      ) : (
        <DataTable
          data={runs}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'pick',
              label: '',
              render: (r) => (
                <Checkbox
                  checked={picked.includes(r.id)}
                  disabled={!picked.includes(r.id) && picked.length >= 2}
                  onCheckedChange={() => togglePick(r.id)}
                  aria-label={`Select ${r.name} to compare`}
                />
              ),
            },
            { key: 'name', label: 'Run', render: (r) => <span className="text-sm">{r.name}</span> },
            { key: 'status', label: 'Status', render: (r) => <RunSummary run={r} /> },
            { key: 'model', label: 'Model', render: (r) => <span className="font-mono text-xs">{r.variant.model ?? '(default)'}</span> },
          ]}
        />
      )}

      <AppModal
        open={runOpen}
        onClose={() => {
          setRunOpen(false);
          run.reset();
        }}
        size="md"
        title="New experiment run"
        description="Run a dataset against a variant (model / system-prompt override)."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setRunOpen(false);
                run.reset();
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => run.mutate()} disabled={!runDatasetId || run.isPending}>
              {run.isPending ? 'Running…' : 'Run experiment'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="run-dataset">Dataset</Label>
            <Select value={runDatasetId} onValueChange={setRunDatasetId}>
              <Select.Trigger id="run-dataset" className="w-full" aria-label="Dataset to run">
                <Select.Value placeholder="Choose a dataset…" />
              </Select.Trigger>
              <Select.Content>
                {datasets.map((d) => (
                  <Select.Item key={d.id} value={d.id}>
                    {d.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
            {datasets.length === 0 ? (
              <p className="text-xs text-muted-foreground">No datasets yet — create one on the Datasets page first.</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="run-model">Model override</Label>
            <Input
              id="run-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="model (default)"
              className="font-mono text-xs"
              aria-label="Model override"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="run-prompt">System-prompt override (optional)</Label>
            <Textarea
              id="run-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="system prompt override (optional)"
              className="font-mono text-xs"
              rows={3}
              aria-label="Prompt override"
            />
          </div>
          {run.isError ? (
            <Alert intent="warning" title="Could not run" description={errorMessage(run.error)} data-testid="run-error" />
          ) : null}
        </div>
      </AppModal>

      <TracePeekSheet traceId={viewTrace} onClose={() => setViewTrace(null)} />
    </PageShell>
  );
}
