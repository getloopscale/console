import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, User as UserIcon } from 'lucide-react';
import {
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  PageShell,
  Tabs,
  Timestamp,
} from '@usetheo/ui';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { Alert } from '@/components/ui/alert-guard';
import { cascadeForgetEntity } from '@/pages/memory/entity-cascade';
import { ExpandableText, TablePager } from '@/pages/memory/row-cells';
import { SessionPicker } from '@/pages/memory/scope-switcher';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * Plan 2 of dashboard-memory-section-roadmap.md, T2.5.
 *
 * /memory/entities — aggregated entities browser with 4 scope tabs.
 *
 *  - Scope tabs: USER / SESSION / AGENT / REPO — URL state via `useSearchParams('scope')`
 *  - DataTable of {id, memory_count, last_seen_at}
 *  - Trash → ConfirmDialog with affected memory count + cascade-delete
 *    via N parallel forget calls (D3 — concurrency bounded at 5)
 *  - EmptyState when no entities under active scope (D3 inheritance — never NaN)
 */

interface Entity {
  id: string;
  scope_type: string;
  memory_count: number;
  last_seen_at?: string;
  /**
   * M2 — on-demand evolving summary: a digest of the entity's currently-active
   * outgoing relations (`relation → target`). Empty string when it has none.
   */
  summary?: string;
}

interface EntitiesResult {
  entities: Entity[];
}

const SCOPES = ['user', 'session', 'agent', 'repo'] as const;
type Scope = (typeof SCOPES)[number];

const PAGE_SIZE = 25;

export function EntitiesPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Entities'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const scopeParam = searchParams.get('scope');
  const activeScope: Scope =
    SCOPES.includes(scopeParam as Scope) ? (scopeParam as Scope) : 'user';

  const [pendingDelete, setPendingDelete] = useState<Entity | null>(null);
  // #253 Fase 1 — client-side search + pagination over the fetched set.
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  // Session-separation (2026-07-23): the SESSION tab needs an instance.
  const session = searchParams.get('session') ?? '';
  const setSession = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('session', next);
    else params.delete('session');
    setSearchParams(params, { replace: true });
    setOffset(0);
  };

  const setScope = (next: Scope) => {
    const params = new URLSearchParams(searchParams);
    params.set('scope', next);
    setSearchParams(params, { replace: true });
    setOffset(0);
  };

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/memory/entities', activeScope, session] as const,
    // throwOnError so a failed fetch is query.isError, not an empty list rendered
    // as "no entities" (theo-cloud#250).
    queryFn: () =>
      cloudFetch<EntitiesResult>(
        `/v1/dashboard/memory/entities?scope=${activeScope}${
          activeScope === 'session' && session ? `&session_id=${encodeURIComponent(session)}` : ''
        }`,
        {},
        { throwOnError: true },
      ),
  });

  // #252 REAL cascade: every round lists ONLY the entity's memories via the
  // provider's `?entity=` filter (memory_entities join) and forgets them until
  // the filtered set is empty — never the unfiltered global page.
  const cascadeForget = useMutation({
    mutationFn: (entity: Entity) =>
      cascadeForgetEntity(entity.id, {
        scope: activeScope,
        ...(session ? { sessionId: session } : {}),
      }),
    onSuccess: () => {
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/memory/entities'] });
      void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/memory/list'] });
    },
  });

  const all = query.data?.entities ?? [];
  const filtered = q
    ? all.filter((e) => e.id.toLowerCase().includes(q.trim().toLowerCase()))
    : all;
  const entities = filtered.slice(offset, offset + PAGE_SIZE);
  // #253 — hide the SUMMARY column when the whole filtered set has none
  // (instead of a wall of em-dashes that reads as broken).
  const hasSummaries = filtered.some((e) => e.summary);

  const columns: DataTableColumn<Entity>[] = [
    {
      key: 'id',
      label: 'ID',
      render: (row) => <span className="font-mono text-sm">{row.id}</span>,
    },
    {
      key: 'memory_count',
      label: 'Memories',
      render: (row) => <span>{row.memory_count}</span>,
    },
    ...(hasSummaries
      ? [
          {
            key: 'summary',
            label: 'Relations',
            render: (row: Entity) =>
              row.summary ? (
                <ExpandableText text={row.summary} lines={2} />
              ) : (
                <span className="text-muted-foreground text-xs">—</span>
              ),
          } satisfies DataTableColumn<Entity>,
        ]
      : []),
    {
      key: 'last_seen_at',
      label: 'Last seen',
      render: (row) =>
        row.last_seen_at ? (
          <Timestamp value={row.last_seen_at} />
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Forget all memories under ${activeScope}/${row.id}`}
          onClick={() => setPendingDelete(row)}
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageShell
        title="Entities"
        description="Who and what your agent remembers — grouped by scope. Pick a tab to slice."
      >
       <div className="space-y-6">
        <Tabs value={activeScope} onValueChange={(v) => setScope(v as Scope)}>
          <Tabs.List>
            <Tabs.Trigger value="user">USER</Tabs.Trigger>
            <Tabs.Trigger value="session">SESSION</Tabs.Trigger>
            <Tabs.Trigger value="agent">AGENT</Tabs.Trigger>
            <Tabs.Trigger value="repo">REPO</Tabs.Trigger>
          </Tabs.List>
        </Tabs>

        <div className="flex flex-wrap items-end gap-3">
          {activeScope === 'session' ? (
            <SessionPicker value={session} onChange={setSession} />
          ) : null}
          <Input
            aria-label="Search entities"
            placeholder="Search entities…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
            className="w-64"
          />
        </div>

        {query.isError ? (
          <Alert intent="warning" title="Could not load entities">
            The Memory service is not reachable right now. Try refreshing in a moment.
          </Alert>
        ) : query.isLoading ? (
          <Card>Loading…</Card>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={UserIcon}
            title={`No entities under ${activeScope}`}
            description={
              q
                ? 'No entities match the search. Try a different term.'
                : activeScope === 'user'
                  ? 'Your agent hasn\'t learned about any users yet.'
                  : activeScope === 'session' && !session
                    ? 'Pick a session above to inspect its working-memory entities.'
                    : `No ${activeScope} entities have been recorded yet.`
            }
          />
        ) : (
          <Card>
            <DataTable columns={columns} data={entities} rowKey={(row) => row.id} />
            <TablePager
              offset={offset}
              pageSize={PAGE_SIZE}
              pageCount={entities.length}
              total={filtered.length}
              busy={query.isFetching}
              onOffsetChange={setOffset}
            />
          </Card>
        )}
       </div>
      </PageShell>

      {pendingDelete ? (
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          title={`Forget all memories under ${activeScope}/${pendingDelete.id}?`}
          description={
            <div className="space-y-2 text-sm">
              <p>
                This will permanently forget{' '}
                <strong>{pendingDelete.memory_count} memories</strong> under{' '}
                <code className="font-mono">
                  {activeScope}/{pendingDelete.id}
                </code>
                .
              </p>
              <p className="text-muted-foreground">
                Your agent will no longer recall anything about this{' '}
                {activeScope}. This cannot be undone.
              </p>
            </div>
          }
          confirmLabel={cascadeForget.isPending ? 'Forgetting…' : `Forget ${pendingDelete.memory_count} memories`}
          cancelLabel="Cancel"
          intent="destructive"
          confirmationPhrase={`${activeScope}/${pendingDelete.id}`}
          loading={cascadeForget.isPending}
          onConfirm={() => cascadeForget.mutate(pendingDelete)}
        />
      ) : null}
    </>
  );
}
