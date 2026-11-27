import { useEffect, useState } from 'react';
import { useDebouncedValue } from '@/hooks/memory/use-debounced-value';
import { ArrowDownWideNarrow, ArrowUpWideNarrow, History, Search, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, Timestamp } from '@getloopscale/ui';
import { PageShell } from '@/components/ui/page-shell';
import { Alert } from '@/components/ui/alert-guard';
import { ScopeSelect } from '@/pages/memory/scope-switcher';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { useEpisodes } from '@/hooks/memory/use-episodes';

/**
 * episodes-gateway-dashboard — /memory/episodes.
 *
 * The episodic / message-log timeline: the subject's memories as a
 * cursor-paginated, bi-temporal-aware event log (TheMemory v0.14.0
 * `GET /v1/scopes/{type}/{id}/episodes`, proxied via the dashboard BFF). Distinct
 * from the flat Memories table: temporal ordering (newest/oldest), `asOf`
 * historical replay, and a literal text filter — all server-side via the gateway.
 *
 *  - Cursor pagination via useInfiniteQuery (after=nextCursor) → "Load more"
 *  - Order toggle (desc=newest-first default | asc=chronological replay)
 *  - "As of" datetime → bi-temporal replay (see the scope as it was at an instant)
 *  - Text filter (q) — literal partial match, NOT semantic (semantic is Playground recall)
 */



/** `<input type="datetime-local">` yields `YYYY-MM-DDTHH:mm`; widen to an ISO-Z instant. */
function toIsoInstant(local: string): string {
  return local ? `${local}:00Z` : '';
}

export function EpisodesPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Episodes'), [setPageTitle]);
  useRequireAuth();

  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const [queryText, setQueryText] = useState('');
  // Session-separation (2026-07-23): '' = Global tier; a session id switches the
  // temporal log to that session's working memory (SESSION scope at the provider).
  const [session, setSession] = useState('');
  const [asOfLocal, setAsOfLocal] = useState('');

  // B-050 — este useEffect + setTimeout era a terceira copia manual do mesmo
  // debounce no repo, com 350ms contra os 300ms de traces.tsx. A divergencia nao
  // vinha de decisao: vinha de cada tela reimplementar. Agora usa o hook unico.
  const debouncedQuery = useDebouncedValue(queryText.trim());

  const asOf = toIsoInstant(asOfLocal);

  const query = useEpisodes({ order, q: debouncedQuery, asOf, session });

  const items = query.data?.pages.flatMap((p) => p?.items ?? []) ?? [];
  const filtersActive = debouncedQuery !== '' || asOf !== '';

  const clearFilters = () => {
    // `debouncedQuery` deriva de `queryText`, entao limpar a fonte basta — nao ha
    // mais um segundo estado para manter em sincronia (era essa a duplicacao).
    setQueryText('');
    setAsOfLocal('');
  };

  return (
    <PageShell
      title="Episodes"
      description="Your agent's memories as a temporal event log — paginate, replay any point in time, and filter by text."
    >
      <Card>
        <Card.Body>
          <div className="flex flex-wrap items-end gap-3">
            <ScopeSelect value={session} onChange={setSession} id="ep-scope" />
            <div className="min-w-[220px] flex-1">
              <label className="text-muted-foreground mb-1 block text-xs font-medium" htmlFor="ep-q">
                Filter (text contains)
              </label>
              <div className="relative">
                <Search className="text-muted-foreground absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2" />
                <Input
                  id="ep-q"
                  className="pl-8"
                  placeholder="e.g. Lisbon"
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium" htmlFor="ep-asof">
                As of (replay)
              </label>
              <Input
                id="ep-asof"
                type="datetime-local"
                value={asOfLocal}
                onChange={(e) => setAsOfLocal(e.target.value)}
              />
            </div>
            <Button
              variant="secondary"
              onClick={() => setOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
              title="Toggle temporal order"
            >
              {order === 'desc' ? (
                <>
                  <ArrowDownWideNarrow className="mr-1 h-4 w-4" /> Newest first
                </>
              ) : (
                <>
                  <ArrowUpWideNarrow className="mr-1 h-4 w-4" /> Oldest first
                </>
              )}
            </Button>
            {filtersActive && (
              <Button variant="ghost" onClick={clearFilters} title="Clear filters">
                <X className="mr-1 h-4 w-4" /> Clear
              </Button>
            )}
          </div>
          {asOf !== '' && (
            <p className="text-muted-foreground mt-2 text-xs">
              Replaying the scope as it was at <span className="font-medium">{asOf}</span> — memories
              forgotten after this instant still appear.
            </p>
          )}
        </Card.Body>
      </Card>

      {query.isError && (
        <div className="mt-4">
          <Alert intent="warning" title="Could not load episodes">
            The memory service may be temporarily unavailable — try again.
          </Alert>
        </div>
      )}

      {query.isLoading ? (
        <p className="text-muted-foreground mt-6 text-sm">Loading episodes…</p>
      ) : query.isError ? null : items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={History}
            title={filtersActive ? 'No episodes match these filters' : 'No episodes yet'}
            description={
              filtersActive
                ? 'Adjust the text filter or the "as of" instant.'
                : 'Remember something in the Playground, then it appears here on the timeline.'
            }
          />
        </div>
      ) : (
        <ol className="mt-6 space-y-0">
          {items.map((ep, i) => (
            <li key={ep.id} className="relative flex gap-4 pb-6 last:pb-0">
              {/* timeline rail */}
              <div className="flex flex-col items-center">
                <span className="bg-primary mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" />
                {i < items.length - 1 && <span className="bg-border mt-1 w-px flex-1" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm">{ep.text}</p>
                <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                  <Timestamp value={ep.created_at} />
                  <Badge variant="outline">{ep.scope_type}</Badge>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {query.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </PageShell>
  );
}
