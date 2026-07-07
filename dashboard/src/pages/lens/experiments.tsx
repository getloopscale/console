import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, DataTable, type DataTableColumn, Input, PageShell } from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';
import { formatCost, formatDuration, formatTokens, shortId } from '@/lib/format';
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

function errorMessage(err: unknown): string {
  const status = (err as { status?: number } | null)?.status ?? 0;
  switch (status) {
    case 503:
      return 'The provider is not configured — a run needs a provider.';
    case 429:
      return 'Rate limit reached — wait a moment before running again.';
    case 403:
      return 'You do not have permission to run experiments in this workspace.';
    case 404:
      return 'The dataset is not available (it may belong to another workspace).';
    default:
      return 'Could not run the experiment — try again shortly.';
  }
}

/** A single run's aggregate summary line. */
function RunSummary({ run }: { run: ExperimentRun }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs" data-testid="run-summary">
      <Badge variant={run.status === 'completed' ? 'default' : 'outline'}>{run.status}</Badge>
      <span>
        {run.passCount} / {run.itemCount} passed
      </span>
      {run.avgScore !== undefined ? <Badge variant="outline">avg {run.avgScore.toFixed(2)}</Badge> : null}
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
  const [params] = useSearchParams();
  const datasetId = params.get('datasetId') ?? '';
  const compareIds = (params.get('compare') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [viewTrace, setViewTrace] = useState<string | null>(null);

  // Runs list (or dataset-filtered when arriving from "create regression dataset").
  const runsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/experiment-runs', datasetId] as const,
    queryFn: () =>
      cloudFetch<{ runs: ExperimentRun[] }>(`/v1/dashboard/lens/experiment-runs${datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : ''}`),
    enabled: compareIds.length < 2,
  });

  // Compare view: two+ runs (with items) aligned by source trace id.
  const compareQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/experiment-runs/compare', compareIds.join(',')] as const,
    queryFn: () => cloudFetch<{ runs: ExperimentRun[] }>(`/v1/dashboard/lens/experiment-runs/compare?ids=${encodeURIComponent(compareIds.join(','))}`),
    enabled: compareIds.length >= 2,
  });

  const run = useMutation({
    mutationFn: () =>
      cloudFetch<ExperimentRun>(
        '/v1/dashboard/lens/experiment-runs',
        {
          method: 'POST',
          body: JSON.stringify({
            datasetId,
            variant: { ...(model.trim() ? { model: model.trim() } : {}), ...(prompt.trim() ? { promptOverride: prompt.trim() } : {}) },
          }),
        },
        { throwOnError: true },
      ),
    retry: false,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/experiment-runs'] }),
  });
  const latest = run.data ?? null;

  const itemColumns: DataTableColumn<RunItem>[] = [
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
          {row.scores.map((s) => (
            <Badge key={s.name} variant={s.score !== undefined && s.score >= 0.5 ? 'default' : 'outline'}>
              {s.name}: {s.label ?? (s.score ?? 0).toFixed(2)}
            </Badge>
          ))}
        </div>
      ),
    },
    { key: 'metrics', label: 'Cost / latency', render: (row) => <span className="text-xs text-muted-foreground">{formatCost(row.costUsd ?? NaN)} · {formatDuration(row.latencyMs)} · {formatTokens(row.totalTokens)} tok</span> },
    { key: 'view', label: '', render: (row) => <Button variant="ghost" size="sm" onClick={() => setViewTrace(row.datasetItemTraceId)}>View trace</Button> },
  ];

  // Compare view — two+ runs side-by-side + the pass-rate delta.
  if (compareIds.length >= 2) {
    const runs = compareQuery.data?.runs ?? [];
    const delta = runs.length >= 2 ? runs[0].passCount - runs[1].passCount : 0;
    return (
      <PageShell title="Compare runs" description="Two experiment runs side-by-side, aligned by source trace.">
        {compareQuery.isError ? (
          <Alert intent="warning" title="Could not load the comparison">Try again shortly.</Alert>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2 text-sm" data-testid="passrate-delta">
              Pass-count delta: <Badge variant={delta >= 0 ? 'default' : 'outline'}>{delta >= 0 ? `+${delta}` : delta}</Badge>
            </div>
            <div className="flex gap-3 overflow-x-auto">
              {runs.map((r) => (
                <Card key={r.id} className="w-[420px] shrink-0">
                  <Card.Body className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{r.name}</span>
                      {r.variant.model ? <Badge variant="outline">{r.variant.model}</Badge> : null}
                    </div>
                    <RunSummary run={r} />
                    <DataTable data={r.items ?? []} columns={itemColumns} rowKey={(row) => row.datasetItemTraceId} />
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
    <PageShell title="Experiments" description="Run a regression dataset against a variant and compare runs.">
      {datasetId ? (
        <Card className="mb-4">
          <Card.Body className="space-y-2">
            <span className="text-xs font-semibold uppercase text-muted-foreground">Run dataset {shortId(datasetId, 12)}</span>
            <div className="flex flex-wrap items-end gap-2">
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="model (default)" className="w-[220px] font-mono text-xs" aria-label="Model override" />
              <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="system prompt override (optional)" className="flex-1 font-mono text-xs" aria-label="Prompt override" />
              <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
                {run.isPending ? 'Running…' : 'Run experiment'}
              </Button>
            </div>
            {run.isError ? (
              <Alert intent="warning" title="Could not run" data-testid="run-error">{errorMessage(run.error)}</Alert>
            ) : null}
            {latest ? (
              <div className="space-y-2" data-testid="latest-run">
                <RunSummary run={latest} />
                <DataTable data={latest.items ?? []} columns={itemColumns} rowKey={(row) => row.datasetItemTraceId} />
              </div>
            ) : null}
          </Card.Body>
        </Card>
      ) : null}

      <span className="text-xs font-semibold uppercase text-muted-foreground">Recent runs</span>
      {runsQuery.isError ? (
        <Alert intent="warning" title="Could not load runs">Try again shortly.</Alert>
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runs yet — create a regression dataset from the traces list, then run it here.</p>
      ) : (
        <DataTable
          data={runs}
          rowKey={(r) => r.id}
          columns={[
            { key: 'name', label: 'Run', render: (r) => <span className="text-sm">{r.name}</span> },
            { key: 'status', label: 'Status', render: (r) => <RunSummary run={r} /> },
            { key: 'model', label: 'Model', render: (r) => <span className="font-mono text-xs">{r.variant.model ?? '(default)'}</span> },
          ]}
        />
      )}

      <TracePeekSheet traceId={viewTrace} onClose={() => setViewTrace(null)} />
    </PageShell>
  );
}
