import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  PageShell,
  Skeleton,
} from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
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

export function LensGuardsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Lens · Guards'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [evaluatorId, setEvaluatorId] = useState('');
  const [threshold, setThreshold] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Guard | null>(null);

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/guards'] as const,
    queryFn: () => cloudFetch<GuardsResult>('/v1/dashboard/lens/guards'),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/guards'] });

  const create = useMutation({
    mutationFn: (input: { evaluatorId: string; threshold: number }) =>
      cloudFetch<Guard>('/v1/dashboard/lens/guards', {
        method: 'POST',
        body: JSON.stringify({ evaluatorId: input.evaluatorId, operator: 'gte', threshold: input.threshold }),
      }),
    onSuccess: () => {
      setEvaluatorId('');
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
    { key: 'evaluatorId', label: 'Evaluator', render: (row) => <span className="font-mono text-sm">{row.evaluatorId ?? '—'}</span> },
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
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const t = Number(threshold);
                  if (evaluatorId.trim() && !Number.isNaN(t)) create.mutate({ evaluatorId: evaluatorId.trim(), threshold: t });
                }}
              >
                <div className="flex-1">
                  <Input
                    value={evaluatorId}
                    onChange={(e) => setEvaluatorId(e.target.value)}
                    placeholder="Evaluator id"
                    aria-label="Evaluator id"
                  />
                </div>
                <div className="w-32">
                  <Input
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    placeholder="Threshold"
                    aria-label="Threshold (gte)"
                  />
                </div>
                <Button type="submit" disabled={!evaluatorId.trim() || threshold.trim() === '' || create.isPending}>
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
            <Skeleton />
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
