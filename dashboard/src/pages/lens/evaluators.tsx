import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Trash2 } from 'lucide-react';
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
  Textarea,
} from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * M44 — /lens/evaluators. List / create / run / delete online evaluators via the read+write
 * lens management BFF (`/v1/dashboard/lens/evaluators`). Mirrors the theo-rag write pages. The
 * create body matches theo-lens: {name, kind:"rule"|"llm_judge", config:{predicate}|{prompt,model}}.
 */

interface Evaluator {
  id: string;
  name: string;
  kind?: string;
  enabled?: boolean;
}
interface EvaluatorsResult {
  evaluators: Evaluator[];
}

export function LensEvaluatorsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Evaluators'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [predicate, setPredicate] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Evaluator | null>(null);

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/evaluators'] as const,
    queryFn: () => cloudFetch<EvaluatorsResult>('/v1/dashboard/lens/evaluators'),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/evaluators'] });

  const create = useMutation({
    mutationFn: (input: { name: string; predicate: string }) =>
      cloudFetch<Evaluator>('/v1/dashboard/lens/evaluators', {
        method: 'POST',
        body: JSON.stringify({ name: input.name, kind: 'rule', config: { predicate: input.predicate } }),
      }),
    onSuccess: () => {
      setName('');
      setPredicate('');
      invalidate();
    },
  });

  const run = useMutation({
    mutationFn: (id: string) =>
      cloudFetch<{ written: number }>(`/v1/dashboard/lens/evaluators/${encodeURIComponent(id)}/run`, {
        method: 'POST',
        body: JSON.stringify({ limit: 100 }),
      }),
  });

  const remove = useMutation({
    mutationFn: (e: Evaluator) =>
      cloudFetch<null>(`/v1/dashboard/lens/evaluators/${encodeURIComponent(e.id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
    },
  });

  const columns: DataTableColumn<Evaluator>[] = [
    { key: 'name', label: 'Name', render: (row) => <span>{row.name}</span> },
    { key: 'kind', label: 'Kind', render: (row) => <span>{row.kind ?? '—'}</span> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => run.mutate(row.id)} aria-label={`Run ${row.name}`}>
            <Play className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPendingDelete(row)} aria-label={`Delete ${row.id}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const evaluators = query.data?.evaluators ?? [];

  return (
    <>
      <PageShell title="Evaluators" description="Score traces with rule or LLM-judge evaluators.">
        <div className="space-y-6">
          <Card>
            <Card.Body>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim() && predicate.trim()) create.mutate({ name: name.trim(), predicate: predicate.trim() });
                }}
              >
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="evaluator-name"
                  aria-label="New evaluator name"
                />
                <Textarea
                  value={predicate}
                  onChange={(e) => setPredicate(e.target.value)}
                  placeholder="Rule predicate, e.g. output.length > 0"
                  aria-label="Rule predicate"
                />
                <Button type="submit" disabled={!name.trim() || !predicate.trim() || create.isPending}>
                  Create evaluator
                </Button>
              </form>
              {create.isError ? (
                <Alert intent="destructive" title="Could not create the evaluator" className="mt-3">
                  Try again shortly.
                </Alert>
              ) : null}
              {run.isError ? (
                <Alert intent="warning" title="Could not run the evaluator" className="mt-3">
                  Try again shortly.
                </Alert>
              ) : null}
            </Card.Body>
          </Card>

          {query.isLoading ? (
            <Skeleton />
          ) : query.isError ? (
            <Alert intent="warning" title="Could not load evaluators">
              The lens service is unavailable. Try again shortly.
            </Alert>
          ) : evaluators.length === 0 ? (
            <EmptyState title="No evaluators yet" description="Create your first evaluator to score traces." />
          ) : (
            <Card>
              <DataTable columns={columns} data={evaluators} rowKey={(row) => row.id} />
            </Card>
          )}
        </div>
      </PageShell>

      {pendingDelete ? (
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          title={`Delete evaluator ${pendingDelete.name}?`}
          description={<p className="text-sm">This permanently deletes the evaluator and its guards. This cannot be undone.</p>}
          confirmLabel={remove.isPending ? 'Deleting…' : 'Delete evaluator'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={remove.isPending}
          onConfirm={() => remove.mutate(pendingDelete)}
        />
      ) : null}
    </>
  );
}
