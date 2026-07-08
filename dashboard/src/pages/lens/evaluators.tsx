import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Trash2 } from 'lucide-react';
import { Button, Card, ConfirmDialog, DataTable, type DataTableColumn, EmptyState, Input, Label, PageShell, Select, Textarea } from '@usetheo/ui';
import { ListSkeleton } from '@/components/lens/list-skeleton';
import { Alert } from '@/components/ui/alert-guard';

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

  // E-1: the evaluator kind selects which config the form collects (theo-lens discriminated union:
  // rule → {predicate}, llm_judge → {prompt, model}). Default 'rule' preserves the prior behavior.
  type EvaluatorKind = 'rule' | 'llm_judge';
  const [name, setName] = useState('');
  const [kind, setKind] = useState<EvaluatorKind>('rule');
  const [predicate, setPredicate] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Evaluator | null>(null);

  // The active kind's required fields, and the request body the theo-lens union expects.
  const canCreate =
    name.trim().length > 0 &&
    (kind === 'rule' ? predicate.trim().length > 0 : prompt.trim().length > 0 && model.trim().length > 0);
  const buildCreateBody = () =>
    kind === 'rule'
      ? { name: name.trim(), kind, config: { predicate: predicate.trim() } }
      : { name: name.trim(), kind, config: { prompt: prompt.trim(), model: model.trim() } };

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/evaluators'] as const,
    queryFn: () => cloudFetch<EvaluatorsResult>('/v1/dashboard/lens/evaluators'),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/evaluators'] });

  const create = useMutation({
    mutationFn: (body: ReturnType<typeof buildCreateBody>) =>
      cloudFetch<Evaluator>('/v1/dashboard/lens/evaluators', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setName('');
      setPredicate('');
      setPrompt('');
      setModel('');
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
          <Button variant="ghost" size="sm" onClick={() => setPendingDelete(row)} aria-label={`Delete evaluator ${row.name}`}>
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
                  if (canCreate) create.mutate(buildCreateBody());
                }}
              >
                <Label htmlFor="evaluator-name">Name</Label>
                <Input
                  id="evaluator-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
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
                      placeholder="output.length > 0"
                    />
                    {/* E-2: a concrete example so the predicate field is not a blank mystery box. */}
                    <p className="text-xs text-muted-foreground">
                      A boolean expression over the trace, e.g. <code>output.length &gt; 0</code> or <code>score &gt;= 0.8</code>.
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
                      placeholder="e.g. gpt-4o-mini"
                    />
                  </>
                )}
                <Button type="submit" disabled={!canCreate || create.isPending}>
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
            <ListSkeleton label="evaluators" />
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
