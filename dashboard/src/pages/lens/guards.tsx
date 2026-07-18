import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ShieldAlert, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  CopyButton,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  Label,
  PageShell,
  Select,
  Sheet,
  Skeleton,
} from '@usetheo/ui';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { ListSkeleton } from '@/components/lens/list-skeleton';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { shortId } from '@/lib/format';
import { cloudFetch } from '@/lib/api';

/**
 * M44 — /lens/guards. List / create / delete guards via the read+write lens management BFF
 * (`/v1/dashboard/lens/guards`). The create body matches theo-lens:
 * {evaluatorId, operator:"lt"|"lte"|"gt"|"gte"|"eq"|"label_eq", threshold?}.
 */

interface Guard {
  id: string;
  evaluatorId?: string;
  operator?: string;
  threshold?: number;
}
interface GuardsResult {
  guards: Guard[];
}
interface Evaluator {
  id: string;
  name: string;
}
interface EvaluatorsResult {
  evaluators: Evaluator[];
}

// The guard operators theo-lens accepts. `label_eq` matches a label string (no numeric threshold);
// the others compare the evaluator score to a threshold.
const OPERATORS = [
  { value: 'gte', label: '≥ threshold' },
  { value: 'gt', label: '> threshold' },
  { value: 'lte', label: '≤ threshold' },
  { value: 'lt', label: '< threshold' },
  { value: 'eq', label: '= threshold' },
  { value: 'label_eq', label: 'matches label' },
] as const;

export function LensGuardsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Guards'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [evaluatorId, setEvaluatorId] = useState('');
  const evaluatorTriggerRef = useRef<HTMLButtonElement>(null); // M73 — empty-state CTA focuses the create form
  const [operator, setOperator] = useState<string>('gte');
  const [threshold, setThreshold] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Guard | null>(null);
  // M77 — the guard whose breaches are open in the side panel (null = closed).
  const [activeGuard, setActiveGuard] = useState<Guard | null>(null);

  // `label_eq` matches a label, so it takes NO numeric threshold — the field is hidden + omitted.
  const needsThreshold = operator !== 'label_eq';

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/guards'] as const,
    queryFn: () => cloudFetch<GuardsResult>('/v1/dashboard/lens/guards'),
  });
  // #179 — the evaluator is chosen from the workspace's evaluators (by name), not typed as a raw id
  // the Evaluators screen never surfaced. value = id, label = name.
  const evaluatorsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/evaluators'] as const,
    queryFn: () => cloudFetch<EvaluatorsResult>('/v1/dashboard/lens/evaluators'),
  });
  const evaluators = evaluatorsQuery.data?.evaluators ?? [];
  const evaluatorName = (id?: string) => evaluators.find((e) => e.id === id)?.name ?? (id ? shortId(id) : '—');

  // M77 — a human rule string for the breaches panel (numeric operators as symbols; label_eq spelled out).
  const OP_SYMBOL: Record<string, string> = { gte: '≥', gt: '>', lte: '≤', lt: '<', eq: '=' };
  const guardRuleText = (g: Guard) =>
    g.operator === 'label_eq'
      ? `Traces failing ${evaluatorName(g.evaluatorId)} (label match)`
      : `Traces failing ${evaluatorName(g.evaluatorId)} ${OP_SYMBOL[g.operator ?? ''] ?? g.operator ?? ''} ${g.threshold ?? ''}`.trim();

  // M77 — the breaches read (flag-only: `{ traceIds }`) for the open guard. Fetched on demand only.
  const breachesQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/guards', activeGuard?.id, 'breaches'] as const,
    queryFn: () =>
      cloudFetch<{ traceIds: string[] }>(`/v1/dashboard/lens/guards/${encodeURIComponent(activeGuard!.id)}/breaches`, {}, { throwOnError: true }),
    enabled: activeGuard !== null,
  });
  const breachTraceIds = breachesQuery.data?.traceIds ?? [];

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/guards'] });

  const create = useMutation({
    mutationFn: (input: { evaluatorId: string; operator: string; threshold?: number }) =>
      cloudFetch<Guard>('/v1/dashboard/lens/guards', {
        method: 'POST',
        body: JSON.stringify(
          // omit threshold entirely for a label match (no fabricated 0)
          input.threshold === undefined
            ? { evaluatorId: input.evaluatorId, operator: input.operator }
            : { evaluatorId: input.evaluatorId, operator: input.operator, threshold: input.threshold },
        ),
      }),
    onSuccess: () => {
      setEvaluatorId('');
      setOperator('gte');
      setThreshold('');
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (g: Guard) =>
      cloudFetch<null>(`/v1/dashboard/lens/guards/${encodeURIComponent(g.id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
    },
  });

  const columns: DataTableColumn<Guard>[] = [
    {
      key: 'evaluatorId',
      label: 'Evaluator',
      render: (row) =>
        row.evaluatorId ? (
          <div className="flex items-center gap-1">
            <span className="font-mono text-sm" title={row.evaluatorId}>
              {shortId(row.evaluatorId)}
            </span>
            <CopyButton value={row.evaluatorId} label="Copy evaluator id" />
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: 'operator', label: 'Operator', render: (row) => <span>{row.operator ?? '—'}</span> },
    { key: 'threshold', label: 'Threshold', render: (row) => <span>{row.threshold ?? '—'}</span> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setActiveGuard(row)} aria-label={`View breaches for ${evaluatorName(row.evaluatorId)}`}>
            <ShieldAlert className="mr-1 h-4 w-4" /> View breaches
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPendingDelete(row)} aria-label={`Delete ${row.id}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const guards = query.data?.guards ?? [];

  return (
    <>
      <PageShell title="Guards" description="Gate traces on evaluator thresholds.">
        <div className="space-y-6">
          <Card>
            <Card.Body>
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!evaluatorId) return;
                  if (needsThreshold) {
                    const t = Number(threshold);
                    if (threshold.trim() === '' || Number.isNaN(t)) return;
                    create.mutate({ evaluatorId, operator, threshold: t });
                  } else {
                    create.mutate({ evaluatorId, operator }); // label_eq — no threshold
                  }
                }}
              >
                <div className="min-w-[200px] flex-1">
                  <Label htmlFor="guard-evaluator">Evaluator</Label>
                  <Select value={evaluatorId} onValueChange={setEvaluatorId}>
                    <Select.Trigger ref={evaluatorTriggerRef} id="guard-evaluator" className="w-full" aria-label="Evaluator">
                      <Select.Value placeholder={evaluators.length === 0 ? 'No evaluators — create one first' : 'Choose an evaluator'} />
                    </Select.Trigger>
                    <Select.Content>
                      {evaluators.map((ev) => (
                        <Select.Item key={ev.id} value={ev.id}>
                          {ev.name}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </div>
                <div className="w-40">
                  <Label htmlFor="guard-operator">Operator</Label>
                  <Select value={operator} onValueChange={setOperator}>
                    <Select.Trigger id="guard-operator" className="w-full" aria-label="Operator">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      {OPERATORS.map((op) => (
                        <Select.Item key={op.value} value={op.value}>
                          {op.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </div>
                {needsThreshold ? (
                  <div className="w-32">
                    <Label htmlFor="guard-threshold">Threshold</Label>
                    <Input
                      id="guard-threshold"
                      value={threshold}
                      onChange={(e) => setThreshold(e.target.value)}
                      placeholder="0.5"
                    />
                  </div>
                ) : null}
                <Button
                  type="submit"
                  disabled={!evaluatorId || (needsThreshold && threshold.trim() === '') || create.isPending}
                >
                  Create guard
                </Button>
              </form>
              {create.isError ? (
                <Alert intent="destructive" title="Could not create the guard" className="mt-3">
                  Try again shortly.
                </Alert>
              ) : null}
            </Card.Body>
          </Card>

          {query.isLoading ? (
            <ListSkeleton label="guards" />
          ) : query.isError ? (
            <Alert intent="warning" title="Could not load guards">
              The lens service is unavailable. Try again shortly.
            </Alert>
          ) : guards.length === 0 ? (
            <EmptyState
              title="No guards yet"
              description="Create your first guard to gate traces on a threshold."
              action={
                <Button variant="secondary" size="sm" onClick={() => evaluatorTriggerRef.current?.focus()}>
                  Create your first guard
                </Button>
              }
            />
          ) : (
            <Card>
              <DataTable columns={columns} data={guards} rowKey={(row) => row.id} />
            </Card>
          )}
        </div>
      </PageShell>

      {pendingDelete ? (
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          title={`Delete guard ${pendingDelete.id}?`}
          description={<p className="text-sm">This permanently deletes the guard. This cannot be undone.</p>}
          confirmLabel={remove.isPending ? 'Deleting…' : 'Delete guard'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={remove.isPending}
          onConfirm={() => remove.mutate(pendingDelete)}
        />
      ) : null}

      {/* M77 — the breaches panel: what this guard actually gated. The read is flag-only ({traceIds}),
          so we list the breaching traces (deep-linked to their peek) and frame them with the guard's own
          rule — never a fabricated per-breach score/time. */}
      <Sheet open={activeGuard !== null} onOpenChange={(open) => !open && setActiveGuard(null)}>
        <Sheet.Content side="right" className="w-full sm:max-w-md">
          <Sheet.Header className="border-b border-border px-6 py-4">
            <Sheet.Title>Guard breaches</Sheet.Title>
            <Sheet.Description>{activeGuard ? guardRuleText(activeGuard) : ''}</Sheet.Description>
          </Sheet.Header>
          <Sheet.Body className="space-y-3 px-6 py-5">
            {breachesQuery.isPending ? (
              <Skeleton className="h-24 w-full" aria-label="Loading breaches" />
            ) : breachesQuery.isError ? (
              <Alert intent="warning" title="Could not load breaches" data-testid="breaches-error">
                The lens service is unavailable. Try again shortly.
              </Alert>
            ) : breachTraceIds.length === 0 ? (
              <EmptyState title="No breaches yet" description="No trace has failed this guard." />
            ) : (
              <ul className="space-y-1">
                {breachTraceIds.map((tid) => (
                  <li key={tid} className="flex items-center gap-2">
                    <Link
                      to={`/observability/traces?trace=${encodeURIComponent(tid)}`}
                      className="font-mono text-xs text-primary underline underline-offset-2"
                      aria-label={`Open trace ${tid}`}
                    >
                      {shortId(tid)}
                    </Link>
                    <CopyButton value={tid} label="Copy trace id" />
                  </li>
                ))}
              </ul>
            )}
          </Sheet.Body>
        </Sheet.Content>
      </Sheet>
    </>
  );
}
