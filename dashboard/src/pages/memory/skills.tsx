import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { Boxes, Eye, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  PageShell,
  Timestamp,
} from '@usetheo/ui';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * skills-cross-repo-flat-list-gateway — /memory/skills browse + CURATE.
 *
 *  - Lists ALL of the subject's skills across EVERY repo BY DEFAULT (no repoId
 *    gate) via GET /v1/dashboard/memory/skills/all. Each row carries its `repoId`
 *    (rendered as a Repo column).
 *  - Search (`q`, literal description substring) + offset pagination, URL-driven.
 *  - D2 guardrail preserved: the only WRITE control is DELETE (forget) curation —
 *    NO code editor, NO create form, NO executor. Delete uses the row's `repoId`.
 *  - EC-3: skills with null code (derived/consolidated) render gracefully.
 */

interface SkillWithRepo {
  id: string;
  hash: string;
  description: string;
  code: string | null;
  codeLanguage: string | null;
  createdAt: string;
  derivedFrom: string[];
  supersededBy: string | null;
  repoId: string;
}

interface SkillsAllResult {
  skills: SkillWithRepo[];
  total: number;
  truncated: boolean;
}

const PAGE_SIZE = 25;

export function SkillsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Skills'), [setPageTitle]);
  useRequireAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<SkillWithRepo | null>(null);
  // Code/instructions belong in a details view, NOT a table column (keeps the
  // list scannable). A row's "View details" opens this dialog with the full code.
  const [detail, setDetail] = useState<SkillWithRepo | null>(null);

  // B-050 — a busca escrevia direto no searchParam, que alimentava a queryKey:
  // cada tecla disparava um GET. Agora o input le o estado imediato (digitacao
  // responsiva) e a QUERY consome o valor debouncido pelo hook compartilhado.
  const qParam = searchParams.get('q') ?? '';
  const [qInput, setQInput] = useState(qParam);
  const q = useDebouncedValue(qInput);
  const offset = Number(searchParams.get('offset') ?? '0');

  // O parametro de URL segue o valor JA debouncido, entao o historico de
  // navegacao nao ganha uma entrada por tecla.
  useEffect(() => {
    if (q !== qParam) updateParam('q', q);
    // updateParam depende de searchParams e recria a cada render; a dependencia
    // relevante e o valor debouncido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === '') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    // any filter change resets pagination
    if (key !== 'offset') next.delete('offset');
    setSearchParams(next, { replace: true });
  };

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/memory/skills/all', { q, offset }] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      if (offset > 0) params.set('offset', String(offset));
      if (q !== '') params.set('q', q);
      // throwOnError so a failed fetch is query.isError, not an empty list rendered
      // as "no skills" (theo-cloud#250).
      return cloudFetch<SkillsAllResult>(
        `/v1/dashboard/memory/skills/all?${params.toString()}`,
        {},
        { throwOnError: true },
      );
    },
  });

  const skills = query.data?.skills ?? [];
  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + skills.length < total;

  // D2 curation: forget (delete) a bad skill via its OWN repoId. NO create/edit.
  const forgetSkill = useMutation({
    mutationFn: async (skill: SkillWithRepo) => {
      await cloudFetch<null>(
        `/v1/dashboard/memory/skills/${encodeURIComponent(skill.id)}?repoId=${encodeURIComponent(skill.repoId)}`,
        { method: 'DELETE' },
      );
    },
    onSuccess: () => {
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/memory/skills/all'] });
    },
  });

  const columns: DataTableColumn<SkillWithRepo>[] = [
    {
      key: 'repoId',
      label: 'Repo',
      render: (row) => <span className="font-mono text-xs">{row.repoId}</span>,
    },
    {
      key: 'description',
      label: 'Skill',
      render: (row) => (
        <div className="flex flex-col">
          <span>{row.description}</span>
          {row.derivedFrom.length > 0 ? (
            <span className="text-muted-foreground text-xs">
              derived from {row.derivedFrom.length} source
              {row.derivedFrom.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'codeLanguage',
      label: 'Language',
      render: (row) =>
        row.codeLanguage ? (
          <span className="font-mono text-xs">{row.codeLanguage}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      key: 'createdAt',
      label: 'Created',
      render: (row) => <Timestamp value={row.createdAt} />,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`View details for skill ${row.description}`}
            onClick={() => setDetail(row)}
          >
            <Eye className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Forget skill ${row.description}`}
            onClick={() => setPendingDelete(row)}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PageShell
      title="Skills"
      description="Every executable skill your agent has learned, across all repos. Delete a bad one to curate the library — authoring happens via the agent (SDK/MCP)."
    >
      <div className="space-y-6">
        <div className="max-w-sm">
          <label htmlFor="skills-search" className="text-sm font-medium">
            Search
          </label>
          <Input
            id="skills-search"
            placeholder="Filter by description…"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </div>

        {query.isError ? (
          <Alert intent="warning" title="Could not load skills">
            The Memory service is not reachable right now. Try refreshing in a moment.
          </Alert>
        ) : query.isLoading ? (
          <Card>Loading…</Card>
        ) : skills.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={q !== '' ? 'No skills match your search' : 'No skills yet'}
            description={
              q !== ''
                ? 'Try a different search term, or clear the filter.'
                : 'Your agent has not learned any skills yet. Skills are authored by the agent via the SDK/MCP.'
            }
          />
        ) : (
          <div className="space-y-3">
            <Card>
              <DataTable columns={columns} data={skills} rowKey={(row) => row.id} />
            </Card>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">
                {total} skill{total === 1 ? '' : 's'} across all repos
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!hasPrev}
                  onClick={() => updateParam('offset', String(Math.max(0, offset - PAGE_SIZE)))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!hasNext}
                  onClick={() => updateParam('offset', String(offset + PAGE_SIZE))}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {detail ? (
        <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>{detail.description}</Dialog.Title>
              <Dialog.Description>
                <span className="font-mono">{detail.repoId}</span>
                {detail.codeLanguage ? ` · ${detail.codeLanguage}` : ''}
              </Dialog.Description>
            </Dialog.Header>
            <Dialog.Body>
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground text-xs">
                  <span>
                    Created: <Timestamp value={detail.createdAt} />
                  </span>
                  {detail.derivedFrom.length > 0 ? (
                    <span>
                      Derived from {detail.derivedFrom.length} source
                      {detail.derivedFrom.length === 1 ? '' : 's'}
                    </span>
                  ) : null}
                  {detail.supersededBy ? <span>Superseded</span> : null}
                </div>
                <div>
                  <span className="text-xs font-medium text-muted-foreground">Code</span>
                  {detail.code ? (
                    <pre className="mt-1 max-h-96 overflow-auto rounded bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-words">
                      {detail.code}
                    </pre>
                  ) : (
                    <p className="mt-1 text-muted-foreground text-xs">
                      No code — this is a derived/consolidated skill (narrative only).
                    </p>
                  )}
                </div>
              </div>
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="secondary" onClick={() => setDetail(null)}>
                Close
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog>
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          title="Forget this skill?"
          description={
            <div className="space-y-2 text-sm">
              <p>
                This will permanently forget the skill{' '}
                <strong>{pendingDelete.description}</strong> from{' '}
                <code className="font-mono">{pendingDelete.repoId}</code>.
              </p>
              <p className="text-muted-foreground">
                Your agent will no longer recall this skill. This cannot be undone.
              </p>
            </div>
          }
          confirmLabel={forgetSkill.isPending ? 'Forgetting…' : 'Forget skill'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={forgetSkill.isPending}
          onConfirm={() => forgetSkill.mutate(pendingDelete)}
        />
      ) : null}
    </PageShell>
  );
}
