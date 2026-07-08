import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryState, parseAsString, parseAsStringEnum } from 'nuqs';
import { Button, Card, DataTable, EmptyState, Input, PageShell } from '@usetheo/ui';
import { ListSkeleton } from '@/components/lens/list-skeleton';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';
import { triggerDownload } from '@/lib/download';
import {
  fetchFilteredTraces,
  tracesToCsv,
  tracesToJson,
  EXPORT_CAP,
  type ExportTrace,
} from '@/lib/traces-export';
import { tracesColumns, type Trace } from './traces/columns';
import { SavedViewsBar } from './traces/saved-views';
import { TracePeekSheet } from './traces/peek-sheet';
import { TracesTableToolbar } from './traces/table-toolbar';
import { FilterBar } from './traces/filter-bar';
import { EMPTY_FILTERS, RANGE_VALUES, type Range, type TraceFilters } from './traces/filter-model';
import { ColumnsToggle } from './traces/columns-toggle';
import { TOGGLEABLE_COLUMNS, decodeColumns, encodeColumns, isColumnVisible } from './traces/view-encoding';

// M59 P0 (D1) — re-export the moved list-row type so any importer of `Trace` from `./traces`
// keeps resolving after the decomposition (behavior-preserving shim; no test churn).
export type { Trace };

/**
 * M57 T1.1 — convert an OTLP `startTimeUnixNano` (nanoseconds since epoch, as a
 * string) to an ISO string for the timestamp column. Pure + total: nullish,
 * non-numeric, or non-positive (Go zero-time) input returns null so the cell
 * renders the em-dash. BigInt avoids float precision loss on 19-digit ns.
 */
export function nsToIso(ns: string | undefined | null): string | null {
  if (!ns) return null;
  try {
    const ms = Number(BigInt(ns) / 1_000_000n);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

/**
 * M44 — /lens/traces. Read the workspace's traces and manage their human-in-the-loop
 * metadata: tags + annotations. M49 — search + filters (name search, status=error, model,
 * time-range) that narrow the list SERVER-SIDE (theo-lens's existing `/v1/traces` filter SQL,
 * forwarded by the BFF), URL-persisted via `nuqs` so a filtered view is shareable. The trace BODY
 * stays read-only (spans arrive via OTLP); only the metadata is browser-authored.
 */

interface TracesResult {
  traces: Trace[];
  // M81 — server-side pagination envelope (workspace-scoped total + the applied window).
  total?: number;
  limit?: number;
  offset?: number;
}

/** M81 — the traces page window. */
const TRACES_PAGE_SIZE = 50;

const RANGE_MS: Record<Exclude<Range, 'all'>, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
};

// M59 P2 — the filter shape + the chip model live in ./traces/filter-model (the pure DIP boundary);
// re-exported here so `traces-export.ts` + `traces.test.tsx` keep resolving (D1 shim).
export type { TraceFilters };

/**
 * Build the `/v1/dashboard/lens/traces` query string from the active filters — active-only (empty /
 * `all` values are omitted so theo-lens sees only real filters), `range` → a `from` ISO timestamp.
 * M52 folds in the advanced filters (cost/token ranges + session) → theo-lens's snake_case params.
 * `now` is injected (not `Date.now()` inline) so the helper is deterministic + unit-testable
 * (`.claude/rules/testing.md` — inject the clock).
 */
export function buildTraceQuery(f: TraceFilters, now: number, window?: { limit: number; offset: number }): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.status === 'error') p.set('status', 'error');
  if (f.model.trim()) p.set('model', f.model.trim());
  if (f.range !== 'all') p.set('from', new Date(now - RANGE_MS[f.range]).toISOString());
  if (f.costMin.trim()) p.set('min_cost_usd', f.costMin.trim());
  if (f.costMax.trim()) p.set('max_cost_usd', f.costMax.trim());
  if (f.tokensMin.trim()) p.set('min_tokens', f.tokensMin.trim());
  if (f.tokensMax.trim()) p.set('max_tokens', f.tokensMax.trim());
  if (f.session.trim()) p.set('session_id', f.session.trim());
  // M81 — the list read carries the page window (limit/offset); the CSV export omits it (exports the
  // whole filtered set up to the engine cap).
  if (window) {
    p.set('limit', String(window.limit));
    p.set('offset', String(window.offset));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function LensTracesPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Traces'), [setPageTitle]);
  useRequireAuth();

  const navigate = useNavigate();
  // M54 — pairwise compare selection. A row is ticked to build a two-trace compare.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // M49 — URL-persisted filters (nuqs): a filtered view is shareable/bookmarkable.
  const [q, setQ] = useQueryState('q', parseAsString.withDefault(''));
  const [status, setStatus] = useQueryState('status', parseAsStringEnum(['all', 'error']).withDefault('all'));
  const [model, setModel] = useQueryState('model', parseAsString.withDefault(''));
  const [range, setRange] = useQueryState('range', parseAsStringEnum([...RANGE_VALUES]).withDefault('all'));
  // M52 — advanced filters (URL-persisted, forwarded server-side).
  const [costMin, setCostMin] = useQueryState('cost_min', parseAsString.withDefault(''));
  const [costMax, setCostMax] = useQueryState('cost_max', parseAsString.withDefault(''));
  const [tokensMin, setTokensMin] = useQueryState('tokens_min', parseAsString.withDefault(''));
  const [tokensMax, setTokensMax] = useQueryState('tokens_max', parseAsString.withDefault(''));
  const [session, setSession] = useQueryState('session', parseAsString.withDefault(''));
  // M59 P1 — row density (URL-persisted so it round-trips into a saved view, Phase 3).
  const [density, setDensity] = useQueryState(
    'density',
    parseAsStringEnum(['comfortable', 'compact']).withDefault('comfortable'),
  );
  // M59 P3 — column visibility as a single versioned `cols=` URL param, so the M52 saved view captures
  // it for free (no schema change — ADR D4). Density is mirrored into the encoded state for round-trip
  // completeness, but the `density` param above stays its source of truth.
  const [cols, setCols] = useQueryState('cols', parseAsString.withDefault(''));
  const columnState = { ...decodeColumns(cols), density };
  const setColumnState = (next: typeof columnState) => void setCols(encodeColumns(next) || null);

  // The search box keeps its own immediate value (responsive typing) and DEBOUNCES into the `q`
  // query-state that drives the server fetch — one request per pause, not per keystroke (a full-text
  // search per character would hammer theo-lens). `q` still owns the URL; the box mirrors it on
  // external changes (URL round-trip, Clear).
  const [searchInput, setSearchInput] = useState(q);
  useEffect(() => setSearchInput(q), [q]);
  useEffect(() => {
    if (searchInput === q) return;
    const t = setTimeout(() => void setQ(searchInput || null), 300);
    return () => clearTimeout(t);
  }, [searchInput, q, setQ]);

  const filters: TraceFilters = { q, status, model, range, costMin, costMax, tokensMin, tokensMax, session };

  // M81 — server-side pagination. A filter change resets to page 1 (a stale offset would request an
  // out-of-range window). Keyed on the filter values (stable across renders, like the query key).
  const [page, setPage] = useState(1);
  const filterKey = JSON.stringify(filters);
  useEffect(() => setPage(1), [filterKey]);

  // M59 P2 — the chip bar hands back a Partial<TraceFilters> (apply/clear); this maps each changed
  // field to its `nuqs` setter (empty → null drops the param). The URL param keys are UNCHANGED, so
  // `buildTraceQuery` + the M49 BFF whitelist are untouched (ADR D2).
  const applyFilters = (p: Partial<TraceFilters>) => {
    if ('q' in p) void setQ(p.q ? p.q : null);
    if ('status' in p) void setStatus(p.status === 'error' ? 'error' : null);
    if ('model' in p) void setModel(p.model ? p.model : null);
    if ('range' in p) void setRange(p.range && p.range !== 'all' ? p.range : null);
    if ('costMin' in p) void setCostMin(p.costMin ? p.costMin : null);
    if ('costMax' in p) void setCostMax(p.costMax ? p.costMax : null);
    if ('tokensMin' in p) void setTokensMin(p.tokensMin ? p.tokensMin : null);
    if ('tokensMax' in p) void setTokensMax(p.tokensMax ? p.tokensMax : null);
    if ('session' in p) void setSession(p.session ? p.session : null);
  };

  const hasActiveFilters =
    q.trim() !== '' ||
    status !== 'all' ||
    model.trim() !== '' ||
    range !== 'all' ||
    costMin.trim() !== '' ||
    costMax.trim() !== '' ||
    tokensMin.trim() !== '' ||
    tokensMax.trim() !== '' ||
    session.trim() !== '';

  // M52 — saved views: a per-tenant store of the current filter URL. Apply = write the whole search
  // string (nuqs re-hydrates every filter); share = the URL itself. The bar + its CRUD live in
  // ./traces/saved-views (M59 ADR D1); the page owns only the URL params + the apply callback.
  const [searchParams, setSearchParams] = useSearchParams();

  // M76 (Q-2) — the open trace-peek is URL-addressable via `?trace=` so it can be linked to (e.g. from
  // the labeling queue) and shared. A row click writes the param; closing the peek clears it. Other
  // query state (filters, saved views) is preserved by mutating the previous params.
  const openID = searchParams.get('trace');
  const setOpenID = (id: string | null) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev); // new instance (idiomatic react-router; don't mutate prev)
      if (id) next.set('trace', id);
      else next.delete('trace');
      return next;
    });

  // Apply a saved view: replace the URL search with its stored query string; nuqs re-reads every key.
  const applyView = (queryString: string) => {
    setSearchParams(new URLSearchParams(queryString.replace(/^\?/, '')));
  };

  const query = useQuery({
    // Key by the filter VALUES (not the derived `from` timestamp) so the cache is stable across
    // renders; `buildTraceQuery` computes `from` from the clock only at fetch time (no refetch loop).
    // M81: the page is part of the key so Next/Prev refetch the right window.
    queryKey: ['cloud', '/v1/dashboard/lens/traces', filters, page] as const,
    queryFn: () =>
      cloudFetch<TracesResult>(
        `/v1/dashboard/lens/traces${buildTraceQuery(filters, Date.now(), { limit: TRACES_PAGE_SIZE, offset: (page - 1) * TRACES_PAGE_SIZE })}`,
      ),
  });
  // M81 — pagination derived state (workspace-scoped total from the response).
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / TRACES_PAGE_SIZE));
  const firstShown = total === 0 ? 0 : (page - 1) * TRACES_PAGE_SIZE + 1;
  const lastShown = Math.min(page * TRACES_PAGE_SIZE, total);

  // M59 P3 — hide the toggleable spine columns the user turned off (identity columns always show).
  const columns = tracesColumns({
    selected,
    toggleSelected,
    onOpen: setOpenID,
    // M61 — dock the Ask copilot to this trace (carries the id in the URL; no manual entry).
    onAsk: (id) => navigate(`/observability/ask?traceId=${encodeURIComponent(id)}`),
  }).filter(
    (c) => !(TOGGLEABLE_COLUMNS as readonly string[]).includes(c.key) || isColumnVisible(columnState, c.key),
  );

  // M57 T1.1 — newest-first by default. Defensive client-side desc sort by
  // startTimeUnixNano (BigInt-safe, missing timestamps sink to the bottom) so the
  // Time column is honestly ordered regardless of the BFF's return order. Stable
  // for equal/absent timestamps; the server-side M49 filters are unaffected.
  const traces = [...(query.data?.traces ?? [])].sort((a, b) => {
    const an = a.startTimeUnixNano;
    const bn = b.startTimeUnixNano;
    if (!an && !bn) return 0;
    if (!an) return 1;
    if (!bn) return -1;
    const d = BigInt(bn) - BigInt(an);
    return d > 0n ? 1 : d < 0n ? -1 : 0;
  });

  // M54 — compare is pairwise: the action is live only with exactly two traces ticked.
  const selectedIds = Array.from(selected);
  const compareHref =
    selectedIds.length === 2
      ? `/observability/compare?ids=${selectedIds[0]},${selectedIds[1]}`
      : undefined;

  // M56 — export the currently-filtered set (CSV/JSON), bounded by EXPORT_CAP with an honest
  // disclosure. Reuses the SAME buildTraceQuery filters as the list (WYSIWYG) + the shipped
  // formula-injection-safe CSV + Blob download helpers.
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [exportDisclosure, setExportDisclosure] = useState<string | null>(null);

  // M64 — turn the selected traces into a regression dataset (create dataset + add each selected trace),
  // then route to the experiments page to run it. Reuses the M44 dataset routes (no new dataset code).
  const createDataset = useMutation({
    mutationFn: async (traceIds: string[]) => {
      const name = `regression ${new Date().toISOString().slice(0, 19)}`;
      const ds = await cloudFetch<{ id: string }>(
        '/v1/dashboard/lens/datasets',
        { method: 'POST', body: JSON.stringify({ name }) },
        { throwOnError: true },
      );
      for (const traceId of traceIds) {
        await cloudFetch(
          `/v1/dashboard/lens/datasets/${encodeURIComponent(ds!.id)}/items`,
          { method: 'POST', body: JSON.stringify({ traceId }) },
          { throwOnError: true },
        );
      }
      return ds!.id;
    },
    retry: false,
    onSuccess: (datasetId) => {
      setSelected(new Set());
      navigate(`/observability/experiments?datasetId=${encodeURIComponent(datasetId)}`);
    },
  });

  async function doExport(format: 'csv' | 'json') {
    setExporting(true);
    setExportError(false);
    setExportDisclosure(null);
    try {
      const baseQuery = buildTraceQuery(filters, Date.now());
      const { traces: rows, capped } = await fetchFilteredTraces(baseQuery, async (queryWithPaging) => {
        const res = await cloudFetch<{ traces: ExportTrace[] }>(`/v1/dashboard/lens/traces${queryWithPaging}`);
        return res?.traces ?? [];
      });
      const stamp = new Date().toISOString();
      if (format === 'csv') {
        triggerDownload(`traces-${stamp}.csv`, tracesToCsv(rows), 'text/csv;charset=utf-8');
      } else {
        triggerDownload(`traces-${stamp}.json`, tracesToJson(rows), 'application/json');
      }
      setExportDisclosure(
        capped
          ? `Exported ${rows.length} traces (export cap of ${EXPORT_CAP} reached — narrow filters to export the rest).`
          : `Exported ${rows.length} traces.`,
      );
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageShell title="Traces" description="Explore executions and manage their tags & annotations.">
        <div className="space-y-6">
          {/* M59 P2 — the search box (primary, debounced) + the chip-filter builder (column→operator
              →value chips over the SAME nuqs params — no BFF change). Replaces the M49/M52 stacked
              Select/Input panel. */}
          <div className="flex flex-wrap items-center gap-3" role="search">
            <div className="min-w-[220px] flex-1">
              <label htmlFor="trace-search" className="sr-only">
                Search traces
              </label>
              <Input
                id="trace-search"
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search trace name or content…"
                aria-label="Search traces"
              />
            </div>
            <FilterBar filters={filters} onApply={applyFilters} />
            {hasActiveFilters ? (
              <Button variant="ghost" size="sm" onClick={() => applyFilters(EMPTY_FILTERS)} aria-label="Clear filters">
                Clear
              </Button>
            ) : null}
          </div>

          <SavedViewsBar searchParams={searchParams} onApply={applyView} />

          {query.isLoading ? (
            <ListSkeleton label="traces" />
          ) : query.isError ? (
            <Alert intent="warning" title="Could not load traces">
              The lens service is unavailable. Try again shortly.
            </Alert>
          ) : traces.length === 0 ? (
            hasActiveFilters ? (
              <EmptyState
                title="No traces match these filters"
                description="Try widening the time range or clearing the search."
              />
            ) : (
              <EmptyState
                title="No traces yet"
                description="Instrument an agent with the Theo SDK and send OTLP spans to see executions here."
                action={
                  <a
                    href="https://docs.usetheo.dev/observability/quickstart"
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-primary underline underline-offset-4"
                  >
                    Instrument an agent →
                  </a>
                }
              />
            )
          ) : (
            <>
              <div className="mb-1 flex items-center justify-end">
                <ColumnsToggle state={columnState} onChange={setColumnState} />
              </div>
              <TracesTableToolbar
                density={density}
                onToggleDensity={() => void setDensity(density === 'compact' ? null : 'compact')}
                exporting={exporting}
                onExport={doExport}
                selectedCount={selected.size}
                compareHref={compareHref}
                onCompare={() => compareHref && navigate(compareHref)}
                onClearSelection={() => setSelected(new Set())}
                onCreateDataset={() => createDataset.mutate(selectedIds)}
                creatingDataset={createDataset.isPending}
              />
              {exportDisclosure ? (
                <p data-testid="export-disclosure" className="mb-2 text-right text-xs text-muted-foreground">
                  {exportDisclosure}
                </p>
              ) : null}
              {exportError ? (
                <Alert intent="warning" title="Export failed" data-testid="export-error" className="mb-2">
                  Could not export the traces — try again.
                </Alert>
              ) : null}
              <p data-testid="traces-count" className="mb-1 text-xs text-muted-foreground">
                {/* M81 — server-side pagination: the read now returns a workspace-scoped `total`, so this
                    discloses the window over the real total (not just the loaded rows). */}
                {total > 0 ? `Showing ${firstShown}–${lastShown} of ${total}` : `${traces.length} ${traces.length === 1 ? 'trace' : 'traces'}`}
              </p>
              <Card>
                {/* M59 P1 — density toggles the row height (compact vs comfortable) via a data-attr
                    + Tailwind arbitrary selectors; URL-persisted so a saved view captures it (P3). */}
                <div
                  data-density={density}
                  className={
                    density === 'compact'
                      ? '[&_tbody_td]:py-1 [&_tbody_td]:text-xs'
                      : '[&_tbody_td]:py-2.5'
                  }
                >
                  <DataTable columns={columns} data={traces} rowKey={(row) => row.traceId} />
                </div>
              </Card>
              {/* M81 — server-side pager (mirrors the M70 labeling-queue): page 2+ reachable, count disclosed. */}
              {pageCount > 1 ? (
                <div className="mt-3 flex items-center justify-end gap-2 text-sm text-muted-foreground">
                  <Button variant="ghost" size="sm" disabled={page <= 1 || query.isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    Previous
                  </Button>
                  <span className="tabular-nums" data-testid="traces-pager">{`Page ${page} / ${pageCount}`}</span>
                  <Button variant="ghost" size="sm" disabled={page >= pageCount || query.isFetching} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              ) : null}
            </>
          )}

          {/* M59 P1 — row-click opens the peek Sheet (was an inline card that pushed the table down). */}
          <TracePeekSheet traceId={openID} onClose={() => setOpenID(null)} />
        </div>
      </PageShell>
    </>
  );
}
