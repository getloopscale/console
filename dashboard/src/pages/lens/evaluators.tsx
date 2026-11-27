import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Play, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  Label,
  Select,
  Textarea,
} from '@getloopscale/ui';
import { PageShell } from '@/components/ui/page-shell';
import { AppModal } from '@/components/ui/app-modal';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { ListSkeleton } from '@/pages/lens/components/list-skeleton';
import { Alert } from '@/components/ui/alert-guard';
import { TrendChart } from '@getloopscale/ui';
import { scoresToSeries } from '@/pages/lens/components/lens-series';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import {
  useEvaluators,
  useCreateEvaluator,
  useDeleteEvaluator,
  useRenameEvaluator,
  useRunEvaluator,
  useEvaluatorRunJob,
  type Evaluator,
} from '@/hooks/lens/use-evaluators';
import {
  useEvaluatorScores,
  SCORES_RANGES,
  scoresQueryKey,
  type ScoresRange,
} from '@/hooks/lens/use-evaluator-scores';

/**
 * M44 — /lens/evaluators. List / create / run / delete online evaluators via the read+write
 * lens management BFF (`/v1/dashboard/lens/evaluators`). Mirrors the looprag write pages. The
 * create body matches looptrace: {name, kind:"rule"|"llm_judge", config:{predicate}|{prompt,model}}.
 */


/** A short, one-line summary of an evaluator's rule for the list column. */
function ruleSummary(ev: Evaluator): string {
  if (ev.kind === 'llm_judge') return `judge · ${ev.config?.model?.trim() || '—'}`;
  const predicate = ev.config?.predicate ?? '';
  return predicate.trim() === '' ? 'match-all' : predicate;
}

/** M133 — an async evaluator-run job (POST /run returns this queued; the client polls for progress). */

// M90 — score-over-time range presets (looptrace whitelist) + the BFF response shape.
const SCORES_RANGE_LABEL: Record<ScoresRange, string> = {
  '1h': 'Last hour',
  '24h': 'Last 24h',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

/** Map a write error's HTTP status to a typed, actionable message (M82 — a 409 name-conflict must
 *  read as "already in use", NEVER a generic failure). */
function writeErrorMessage(err: unknown): string {
  const status = (err as { status?: number } | null)?.status ?? 0;
  switch (status) {
    case 409:
      return 'An evaluator with that name already exists in this workspace.';
    case 403:
      return 'You do not have permission to manage evaluators in this workspace.';
    case 404:
      return 'That evaluator is not available (it may belong to another workspace).';
    default:
      return 'Try again shortly.';
  }
}

export function LensEvaluatorsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Evaluators'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  // E-1: the evaluator kind selects which config the form collects (looptrace discriminated union:
  // rule → {predicate}, llm_judge → {prompt, model}). Default 'rule' preserves the prior behavior.
  type EvaluatorKind = 'rule' | 'llm_judge';
  const [name, setName] = useState('');
  const [kind, setKind] = useState<EvaluatorKind>('rule');
  const [predicate, setPredicate] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  // Create is a centered modal (AppModal), consistent with the rest of the dashboard — replaces the
  // former inline Card form (Evaluate UX standardization: forms open as centered modals, never inline/lateral).
  const [createOpen, setCreateOpen] = useState(false);
  // The evaluator whose rule is being viewed in the detail modal (null = closed).
  const [viewing, setViewing] = useState<Evaluator | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Evaluator | null>(null);
  // M82 — which evaluator is being renamed inline (+ its draft value).
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);

  // The active kind's required fields, and the request body the looptrace union expects.
  const canCreate =
    name.trim().length > 0 &&
    (kind === 'rule' ? predicate.trim().length > 0 : prompt.trim().length > 0 && model.trim().length > 0);
  const buildCreateBody = () =>
    kind === 'rule'
      ? { name: name.trim(), kind, config: { predicate: predicate.trim() } }
      : { name: name.trim(), kind, config: { prompt: prompt.trim(), model: model.trim() } };

  const query = useEvaluators();

  // M90 — score-over-time: a range-selectable per-evaluator mean trend (looptrace
  // GET /v1/metrics/scores via the BFF). Range drives the server-side bucketing.
  const [scoresRange, setScoresRange] = useState<ScoresRange>('7d');
  const scoresQuery = useEvaluatorScores(scoresRange);
  const scoreSeries = scoresToSeries(scoresQuery.data?.scores ?? []);
  // Honest disclosure: scoresToSeries caps at topN numeric evaluators for legibility. If more
  // numeric evaluators exist in the range than are plotted, say so (no silent truncation).
  const numericEvaluatorCount = new Set(
    (scoresQuery.data?.scores ?? []).filter((b) => b.avgScore !== undefined).map((b) => b.name),
  ).size;
  const hiddenEvaluatorCount = Math.max(0, numericEvaluatorCount - scoreSeries.length);

  const create = useCreateEvaluator();

  // M133 — a manual run is async: POST registers a job (202); we then poll GET /evaluator-run-jobs/:id
  // for status + scored/total progress. `activeRun` tracks the in-flight job for the inline status region.
  const [activeRun, setActiveRun] = useState<{ evaluatorName: string; jobId: string } | null>(null);
  const run = useRunEvaluator();

  // Poll the async run job until terminal; on completion, refresh the scores chart so the new verdicts show.
  const runJobQuery = useEvaluatorRunJob(activeRun?.jobId ?? null);
  const runJob = runJobQuery.data ?? null;
  useEffect(() => {
    if (runJob?.status === 'completed') {
      void queryClient.invalidateQueries({ queryKey: scoresQueryKey });
    }
  }, [runJob?.status, queryClient]);
  const runInFlight = run.isPending || (runJob !== null && runJob.status !== 'completed' && runJob.status !== 'failed');

  const remove = useDeleteEvaluator();

  const rename = useRenameEvaluator();

  const commitRename = () => {
    if (!renaming) return;
    const row = (query.data?.evaluators ?? []).find((e) => e.id === renaming.id);
    const name = renaming.value.trim();
    if (!row || name.length === 0 || name === row.name) {
      setRenaming(null);
      return;
    }
    rename.mutate({ id: row.id, name });
  };

  const submitCreate = () => {
    if (canCreate) create.mutate(buildCreateBody());
  };
  const closeCreate = () => {
    setCreateOpen(false);
    setName('');
    setPredicate('');
    setPrompt('');
    setModel('');
    create.reset();
  };

  const columns: DataTableColumn<Evaluator>[] = [
    {
      key: 'name',
      label: 'Name',
      render: (row) =>
        renaming?.id === row.id ? (
          <Input
            autoFocus
            aria-label={`Rename evaluator ${row.name}`}
            value={renaming.value}
            onChange={(e) => setRenaming({ id: row.id, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setRenaming(null);
            }}
            onBlur={commitRename}
            className="max-w-[220px]"
          />
        ) : (
          <span>{row.name}</span>
        ),
    },
    { key: 'kind', label: 'Kind', render: (row) => <span>{row.kind ?? '—'}</span> },
    {
      key: 'rule',
      label: 'Rule',
      // A short one-line summary of the rule (predicate / judge · model); the full text is in the View modal.
      render: (row) => (
        <span className="block max-w-[280px] truncate font-mono text-xs text-muted-foreground" title={ruleSummary(row)}>
          {ruleSummary(row)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" aria-label={`View rule for ${row.name}`} onClick={() => setViewing(row)}>
            View
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // `setActiveRun` vive AQUI porque é estado DA TELA: qual execução esta página está
              // acompanhando. O hook devolve o job; decidir exibi-lo é decisão de quem exibe.
              run.mutate(row.id, {
                onSuccess: (job) => {
                  if (job) setActiveRun({ evaluatorName: row.name, jobId: job.id });
                },
              });
            }}
            disabled={runInFlight}
            aria-label={`Run ${row.name}`}
          >
            <Play className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" aria-label={`Rename evaluator ${row.name}`} onClick={() => setRenaming({ id: row.id, value: row.name })}>
            Rename
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Delete evaluator ${row.name}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setRenaming(null);
              setPendingDelete(row);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const evaluators = query.data?.evaluators ?? [];

  return (
    <>
      <PageShell
        title="Evaluators"
        description="Score traces with rule or LLM-judge evaluators."
        primaryAction={{ label: 'New evaluator', icon: Plus, onClick: () => setCreateOpen(true) }}
      >
        <div className="space-y-6">
          {run.isError ? (
            <Alert intent="warning" title="Could not start the run" data-testid="run-error">
              Try again shortly.
            </Alert>
          ) : activeRun && runJob ? (
            runJob.status === 'failed' ? (
              <Alert intent="warning" title={`Run failed · ${activeRun.evaluatorName}`} data-testid="run-status">
                {runJob.errorMessage ?? 'The evaluator run failed.'}
              </Alert>
            ) : runJob.status === 'completed' ? (
              <Alert intent="success" title={`Run complete · ${activeRun.evaluatorName}`} data-testid="run-status">
                Scored {runJob.scored} of {runJob.total} span{runJob.total === 1 ? '' : 's'}
                {runJob.errors > 0 ? ` (${runJob.errors} error${runJob.errors === 1 ? '' : 's'})` : ''}.
              </Alert>
            ) : (
              <Alert intent="info" title={`Scoring · ${activeRun.evaluatorName}`} data-testid="run-status">
                {runJob.status === 'queued'
                  ? 'Queued…'
                  : `Scoring ${runJob.scored}${runJob.total ? ` / ${runJob.total}` : ''}…`}
              </Alert>
            )
          ) : null}


          {/* M90 — score over time: is eval quality trending up or down? One mean-line per numeric
              evaluator over the selected range. Categorical-only evaluators are not plotted on a mean
              axis; an empty range is an honest empty (never a fabricated zero line). */}
          <section className="space-y-3" data-testid="scores-over-time" aria-label="Evaluation scores over time">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Scores over time</h2>
              <div className="flex items-center gap-2">
                <span className="sr-only" id="scores-range-label">Time range</span>
                <Select value={scoresRange} onValueChange={(v) => setScoresRange(v as ScoresRange)}>
                  <Select.Trigger className="w-[150px]" aria-label="Scores time range">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {SCORES_RANGES.map((r) => (
                      <Select.Item key={r} value={r}>
                        {SCORES_RANGE_LABEL[r]}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
            </div>
            {scoresQuery.isError ? (
              <Alert
                intent="warning"
                title="Could not load score trends"
                description="The scores service is not reachable right now. Try a different range or refresh in a moment."
                data-testid="scores-error"
              />
            ) : scoresQuery.isPending ? (
              <ListSkeleton label="Loading score trends" />
            ) : scoreSeries.length === 0 ? (
              <EmptyState
                title="No evaluations yet"
                description="Once evaluators score traces in this range, their mean trend appears here."
              />
            ) : (
              <Card aria-label="Evaluation scores over time trend">
                <Card.Body className="space-y-2">
                  <TrendChart
                    title="Mean score by evaluator"
                    series={scoreSeries}
                    yMax={1}
                    valueFormatter={(v) => v.toFixed(2)}
                  />
                  {hiddenEvaluatorCount > 0 ? (
                    <p className="text-xs text-muted-foreground" data-testid="scores-truncation-note">
                      Showing the top {scoreSeries.length} of {numericEvaluatorCount} evaluators by sample volume.
                    </p>
                  ) : null}
                </Card.Body>
              </Card>
            )}
          </section>

          {query.isLoading ? (
            <ListSkeleton label="evaluators" />
          ) : query.isError ? (
            <Alert intent="warning" title="Could not load evaluators">
              The lens service is unavailable. Try again shortly.
            </Alert>
          ) : evaluators.length === 0 ? (
            <EmptyState
              title="No evaluators yet"
              description="Create your first evaluator to score traces."
              action={
                <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
                  Create your first evaluator
                </Button>
              }
            />
          ) : (
            <Card>
              <DataTable columns={columns} data={evaluators} rowKey={(row) => row.id} />
            </Card>
          )}

          {rename.isError ? (
            <Alert intent="warning" title="Could not rename the evaluator" description={writeErrorMessage(rename.error)} data-testid="rename-error" />
          ) : null}

        </div>
      </PageShell>

      <AppModal
        open={createOpen}
        onClose={closeCreate}
        size="md"
        title="New evaluator"
        description="Score traces with a rule predicate or an LLM judge."
        footer={
          <>
            <Button variant="secondary" onClick={closeCreate}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={!canCreate || create.isPending}>
              {create.isPending ? 'Creating…' : 'Create evaluator'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Label htmlFor="evaluator-name">Name</Label>
          <Input
            id="evaluator-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreate();
            }}
            placeholder="evaluator-name"
          />
          <Label htmlFor="evaluator-kind">Kind</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as EvaluatorKind)}>
            <Select.Trigger id="evaluator-kind" className="w-[220px]" aria-label="Evaluator kind">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="rule">Rule (predicate)</Select.Item>
              <Select.Item value="llm_judge">LLM judge (prompt + model)</Select.Item>
            </Select.Content>
          </Select>
          {kind === 'rule' ? (
            <>
              <Label htmlFor="evaluator-predicate">Rule predicate</Label>
              <Textarea
                id="evaluator-predicate"
                value={predicate}
                onChange={(e) => setPredicate(e.target.value)}
                placeholder="status:error"
              />
              {/* E-2: a concrete example matching the real span-query DSL (space-separated
                  field:value clauses, AND-ed) — not a JS expression, which would fail validation. */}
              <p className="text-xs text-muted-foreground">
                Space-separated <code>field:value</code> clauses (all must match). Fields: <code>kind</code>,{' '}
                <code>name</code>, <code>status</code>, <code>model</code>. e.g. <code>status:error</code> or{' '}
                <code>kind:llm model:gpt-4o</code>.
              </p>
            </>
          ) : (
            <>
              <Label htmlFor="evaluator-prompt">Judge prompt</Label>
              <Textarea
                id="evaluator-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Grade the answer for factual accuracy. Reply PASS or FAIL."
              />
              <Label htmlFor="evaluator-model">Judge model</Label>
              <Input
                id="evaluator-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCreate();
                }}
                placeholder="e.g. gpt-4o-mini"
              />
            </>
          )}
          {create.isError ? (
            <Alert intent="destructive" title="Could not create the evaluator">
              Try again shortly.
            </Alert>
          ) : null}
        </div>
      </AppModal>

      <AppModal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        size="md"
        title={viewing ? `Rule · ${viewing.name}` : 'Rule'}
        description={
          viewing?.kind === 'llm_judge'
            ? 'LLM-judge evaluator — the judge prompt and pinned model.'
            : 'Rule evaluator — the span-query predicate.'
        }
      >
        {viewing ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Kind</span>
              <Badge variant="outline">{viewing.kind ?? '—'}</Badge>
            </div>
            {viewing.kind === 'llm_judge' ? (
              <>
                <div className="space-y-1">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">Model</span>
                  <p className="font-mono text-sm">{viewing.config?.model?.trim() || '—'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">Judge prompt</span>
                  <pre className="whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs" data-testid="rule-detail">
                    {viewing.config?.prompt?.trim() || '—'}
                  </pre>
                </div>
              </>
            ) : (
              <div className="space-y-1">
                <span className="text-xs font-semibold uppercase text-muted-foreground">Predicate</span>
                <pre className="whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs" data-testid="rule-detail">
                  {viewing.config?.predicate?.trim() || 'match-all (empty predicate)'}
                </pre>
                <p className="text-xs text-muted-foreground">
                  Space-separated <code>field:value</code> clauses (all must match). Fields: <code>kind</code>, <code>model</code>,{' '}
                  <code>status</code>, …
                </p>
              </div>
            )}
          </div>
        ) : null}
      </AppModal>

      {pendingDelete ? (
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          title={`Delete evaluator ${pendingDelete.name}?`}
          description={<p className="text-sm">This permanently deletes the evaluator and its monitors. This cannot be undone.</p>}
          confirmLabel={remove.isPending ? 'Deleting…' : 'Delete evaluator'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={remove.isPending}
          onConfirm={async () => {
            // `mutateAsync`: o `ConfirmDialog` dá `await` no `onConfirm`, e só assim uma recusa o
            // mantém aberto com o motivo (B-105). Com `mutate` a rejeição é engolida e o diálogo
            // fecha sobre uma remoção que não aconteceu.
            await remove.mutateAsync(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      ) : null}
    </>
  );
}
