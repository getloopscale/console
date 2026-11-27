import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  Timestamp,
} from '@getloopscale/ui';
import { PageShell } from '@/components/ui/page-shell';
import { ForgetMemoryDialog } from '@/pages/memory/forget-dialog';
import { EmDash, ExpandableText, TablePager } from '@/pages/memory/row-cells';
import { ScopeSelect } from '@/pages/memory/scope-switcher';
import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import {
  useMemories,
  useForgetMemory,
  MEMORIES_PAGE_SIZE,
  type MemoryRow,
} from '@/hooks/memory/use-memories';

/**
 * Plan 1 of dashboard-memory-section-roadmap.md, T1.8.
 *
 * /memory/memories — paginated browser for the customer's memories.
 *
 *  - Filter by category (Select) + date range (2 date inputs)
 *  - URL state preserved via useSearchParams so deep-links carry filters
 *  - Trash → ConfirmDialog with confirmationPhrase matching memory id
 *    prefix (DESIGN.md danger zone choreography)
 *  - Empty state for first-time users (D3 informs: empty pgvector renders
 *    cleanly, not as broken table)
 */



export function MemoryListPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Memories'), [setPageTitle]);
  useRequireAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL-driven state — deep links carry filters + page offset.
  const category = searchParams.get('category') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const offset = Number(searchParams.get('offset') ?? '0');
  // Session-separation (2026-07-23): '' = Global tier; a session id switches the
  // listing to that session's working memory (SESSION ∪ GLOBAL at the provider).
  const session = searchParams.get('session') ?? '';

  const [pendingDelete, setPendingDelete] = useState<MemoryRow | null>(null);
  // ADR D4 — hard-delete (GDPR) is opt-in per forget; default stays soft.
  const [hardDelete, setHardDelete] = useState(false);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    // Reset paging when filter changes — otherwise users hit empty pages
    // on a tight result set.
    if (key !== 'offset') next.delete('offset');
    setSearchParams(next, { replace: true });
  };

  const updateOffset = (nextOffset: number) => {
    updateParam('offset', nextOffset > 0 ? String(nextOffset) : '');
  };

  const query = useMemories({ category, from, to, offset, session });

  const forget = useForgetMemory();

  const memories = query.data?.memories ?? [];

  const columns: DataTableColumn<MemoryRow>[] = [
    {
      key: 'content',
      label: 'Memory',
      // UX pass 2026-07-22: imported memories reach tens of thousands of chars —
      // unclamped rows made the table unusable. Clamp to 3 lines; expand on demand.
      render: (row) => <ExpandableText text={row.content} />,
    },
    // In a session view the listing mixes the session's working memory with the
    // global tier (provider SESSION ∪ GLOBAL) — badge the tier per row so the
    // separation is visible. Hidden in the Global view (all rows are global).
    ...(session
      ? [
          {
            key: 'scope',
            label: 'Scope',
            render: (row: MemoryRow) =>
              row.session_id ? (
                <Badge>Session</Badge>
              ) : (
                <Badge variant="outline">Global</Badge>
              ),
          } satisfies DataTableColumn<MemoryRow>,
        ]
      : []),
    {
      key: 'category',
      label: 'Category',
      render: (row) => (row.category ? <Badge variant="outline">{row.category}</Badge> : <EmDash />),
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (row) => (row.created_at ? <Timestamp value={row.created_at} /> : <EmDash />),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Forget memory ${row.id}`}
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
        title="Memories"
        description="Every memory your agent has stored. Use filters to slice by category or date."
      >
       <div className="space-y-6">
        <Card>
          <Card.Body className="flex flex-wrap gap-3 items-end">
            <ScopeSelect value={session} onChange={(s) => updateParam('session', s)} />
            <div>
              <label htmlFor="filter-category" className="text-xs text-muted-foreground block mb-1">
                Category
              </label>
              <Input
                id="filter-category"
                value={category}
                onChange={(e) => updateParam('category', e.target.value)}
                placeholder="e.g. preferences"
                className="w-48"
              />
            </div>
            <div>
              <label htmlFor="filter-from" className="text-xs text-muted-foreground block mb-1">
                From
              </label>
              <Input
                id="filter-from"
                type="date"
                value={from}
                onChange={(e) => updateParam('from', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="filter-to" className="text-xs text-muted-foreground block mb-1">
                To
              </label>
              <Input
                id="filter-to"
                type="date"
                value={to}
                onChange={(e) => updateParam('to', e.target.value)}
              />
            </div>
          </Card.Body>
        </Card>

        {query.isError ? (
          <Alert intent="warning" title="Could not load memories">
            The Memory service is not reachable right now. Try refreshing in a moment.
          </Alert>
        ) : query.isLoading ? (
          <Card>Loading…</Card>
        ) : memories.length === 0 ? (
          <EmptyState
            title="No memories yet"
            description={
              category || from || to
                ? 'No memories match the current filters. Try clearing them.'
                : "Your agent hasn't stored any memories yet. Use the SDK to call remember()."
            }
          />
        ) : (
          <Card>
            <DataTable columns={columns} data={memories} rowKey={(row) => row.id} />
            {/* UX pass 2026-07-22 — the pager was MISSING: with 25/page, everything
                past the first page was unreachable from the UI. */}
            <TablePager
              offset={offset}
              pageSize={MEMORIES_PAGE_SIZE}
              pageCount={memories.length}
              total={query.data?.total}
              busy={query.isFetching}
              onOffsetChange={updateOffset}
            />
          </Card>
        )}
       </div>
      </PageShell>

      {pendingDelete ? (
        <ForgetMemoryDialog
          memory={pendingDelete}
          hardDelete={hardDelete}
          onHardDeleteChange={setHardDelete}
          pending={forget.isPending}
          onConfirm={() => forget.mutate({ id: pendingDelete.id, hard: hardDelete })}
          onClose={() => {
            setPendingDelete(null);
            setHardDelete(false);
          }}
        />
      ) : null}
    </>
  );
}
