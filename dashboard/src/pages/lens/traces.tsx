import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryState, parseAsString, parseAsStringEnum } from 'nuqs';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  Input,
  PageShell,
  Select,
  Skeleton,
} from '@usetheo/ui';

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
}

const RANGE_VALUES = ['all', '1h', '24h', '7d'] as const;
type Range = (typeof RANGE_VALUES)[number];
const RANGE_MS: Record<Exclude<Range, 'all'>, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
};

interface TraceFilters {
  q: string;
  status: 'all' | 'error';
  model: string;
  range: Range;
  // M52 — advanced filters (strings; empty = inactive). Forwarded as theo-lens snake_case params.
  costMin: string;
  costMax: string;
  tokensMin: string;
  tokensMax: string;
  session: string;
}

/**
 * Build the `/v1/dashboard/lens/traces` query string from the active filters — active-only (empty /
 * `all` values are omitted so theo-lens sees only real filters), `range` → a `from` ISO timestamp.
 * M52 folds in the advanced filters (cost/token ranges + session) → theo-lens's snake_case params.
 * `now` is injected (not `Date.now()` inline) so the helper is deterministic + unit-testable
 * (`.claude/rules/testing.md` — inject the clock).
 */
export function buildTraceQuery(f: TraceFilters, now: number): string {
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
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function LensTracesPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Traces'), [setPageTitle]);
  useRequireAuth();

  const navigate = useNavigate();
  const [openID, setOpenID] = useState<string | null>(null);
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

  // Apply a saved view: replace the URL search with its stored query string; nuqs re-reads every key.
  const applyView = (queryString: string) => {
    setSearchParams(new URLSearchParams(queryString.replace(/^\?/, '')));
  };

  const query = useQuery({
    // Key by the filter VALUES (not the derived `from` timestamp) so the cache is stable across
    // renders; `buildTraceQuery` computes `from` from the clock only at fetch time (no refetch loop).
    queryKey: ['cloud', '/v1/dashboard/lens/traces', filters] as const,
    queryFn: () => cloudFetch<TracesResult>(`/v1/dashboard/lens/traces${buildTraceQuery(filters, Date.now())}`),
  });

  const columns = tracesColumns({ selected, toggleSelected, onOpen: setOpenID });

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

  // Model filter options — distinct models present in the current page, plus the active model so it
  // stays selectable even when the page is already narrowed to it. A dedicated models endpoint is a
  // follow-up (see plan § Unresolved questions); this MVP derives options client-side.
  const modelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of traces) if (t.model) set.add(t.model);
    if (model.trim()) set.add(model.trim());
    return Array.from(set).sort();
  }, [traces, model]);

  return (
    <>
      <PageShell title="Traces" description="Explore executions and manage their tags & annotations.">
        <div className="space-y-6">
          <div className="flex flex-wrap items-end gap-3" role="search">
            <div className="min-w-[220px] flex-1">
              <label htmlFor="trace-search" className="mb-1 block text-xs font-medium text-muted-foreground">
                Search
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

            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Status</span>
              <Select value={status} onValueChange={(v) => void setStatus(v === 'all' ? null : (v as 'error'))}>
                <Select.Trigger className="w-[130px]" aria-label="Filter by status">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="all">All statuses</Select.Item>
                  <Select.Item value="error">Errors only</Select.Item>
                </Select.Content>
              </Select>
            </div>

            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Model</span>
              <Select value={model || 'all'} onValueChange={(v) => void setModel(v === 'all' ? null : v)}>
                <Select.Trigger className="w-[190px]" aria-label="Filter by model">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="all">All models</Select.Item>
                  {modelOptions.map((m) => (
                    <Select.Item key={m} value={m}>
                      {m}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>

            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Time range</span>
              <Select value={range} onValueChange={(v) => void setRange(v === 'all' ? null : (v as Range))}>
                <Select.Trigger className="w-[140px]" aria-label="Filter by time range">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="all">All time</Select.Item>
                  <Select.Item value="1h">Last hour</Select.Item>
                  <Select.Item value="24h">Last 24h</Select.Item>
                  <Select.Item value="7d">Last 7 days</Select.Item>
                </Select.Content>
              </Select>
            </div>

            {hasActiveFilters ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void setQ(null);
                  void setStatus(null);
                  void setModel(null);
                  void setRange(null);
                  void setCostMin(null);
                  void setCostMax(null);
                  void setTokensMin(null);
                  void setTokensMax(null);
                  void setSession(null);
                }}
                aria-label="Clear filters"
              >
                Clear
              </Button>
            ) : null}
          </div>

          {/* M52 — advanced filters: cost/token ranges + session (server-side, URL-persisted). */}
          <div className="flex flex-wrap items-end gap-3" aria-label="Advanced filters">
            <div>
              <label htmlFor="cost-min" className="mb-1 block text-xs font-medium text-muted-foreground">
                Cost ≥ (USD)
              </label>
              <Input
                id="cost-min"
                type="number"
                className="w-[120px]"
                value={costMin}
                onChange={(e) => void setCostMin(e.target.value || null)}
                placeholder="min"
                aria-label="Minimum cost USD"
              />
            </div>
            <div>
              <label htmlFor="cost-max" className="mb-1 block text-xs font-medium text-muted-foreground">
                Cost ≤ (USD)
              </label>
              <Input
                id="cost-max"
                type="number"
                className="w-[120px]"
                value={costMax}
                onChange={(e) => void setCostMax(e.target.value || null)}
                placeholder="max"
                aria-label="Maximum cost USD"
              />
            </div>
            <div>
              <label htmlFor="tokens-min" className="mb-1 block text-xs font-medium text-muted-foreground">
                Tokens ≥
              </label>
              <Input
                id="tokens-min"
                type="number"
                className="w-[110px]"
                value={tokensMin}
                onChange={(e) => void setTokensMin(e.target.value || null)}
                placeholder="min"
                aria-label="Minimum tokens"
              />
            </div>
            <div>
              <label htmlFor="tokens-max" className="mb-1 block text-xs font-medium text-muted-foreground">
                Tokens ≤
              </label>
              <Input
                id="tokens-max"
                type="number"
                className="w-[110px]"
                value={tokensMax}
                onChange={(e) => void setTokensMax(e.target.value || null)}
                placeholder="max"
                aria-label="Maximum tokens"
              />
            </div>
            <div className="min-w-[180px] flex-1">
              <label htmlFor="session-filter" className="mb-1 block text-xs font-medium text-muted-foreground">
                Session
              </label>
              <Input
                id="session-filter"
                value={session}
                onChange={(e) => void setSession(e.target.value || null)}
                placeholder="session id (exact)"
                aria-label="Filter by session id"
              />
            </div>
          </div>

          <SavedViewsBar searchParams={searchParams} onApply={applyView} />

          {query.isLoading ? (
            <Skeleton />
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
              <EmptyState title="No traces yet" description="Instrument an agent and send spans to see executions here." />
            )
          ) : (
            <>
              <TracesTableToolbar
                density={density}
                onToggleDensity={() => void setDensity(density === 'compact' ? null : 'compact')}
                exporting={exporting}
                onExport={doExport}
                selectedCount={selected.size}
                compareHref={compareHref}
                onCompare={() => compareHref && navigate(compareHref)}
                onClearSelection={() => setSelected(new Set())}
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
            </>
          )}

          {/* M59 P1 — row-click opens the peek Sheet (was an inline card that pushed the table down). */}
          <TracePeekSheet traceId={openID} onClose={() => setOpenID(null)} />
        </div>
      </PageShell>
    </>
  );
}
