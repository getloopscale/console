import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Button, Card, ConfirmDialog, CopyButton, DataTable, type DataTableColumn, EmptyState, Input, Label, PageShell, Select } from '@usetheo/ui';
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
  const [operator, setOperator] = useState<string>('gte');
  const [threshold, setThreshold] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Guard | null>(null);

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
        <Button variant="ghost" size="sm" onClick={() => setPendingDelete(row)} aria-label={`Delete ${row.id}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
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
                    <Select.Trigger id="guard-evaluator" className="w-full" aria-label="Evaluator">
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
            <EmptyState title="No guards yet" description="Create your first guard to gate traces on a threshold." />
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
    </>
  );
}
