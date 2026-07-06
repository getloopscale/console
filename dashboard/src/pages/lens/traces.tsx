import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryState, parseAsString, parseAsStringEnum } from 'nuqs';
import { BookmarkPlus, Download, GitCompareArrows, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  CopyButton,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  PageShell,
  Select,
  Skeleton,
} from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { formatDate, shortId } from '@/lib/format';
import { cloudFetch } from '@/lib/api';
import { triggerDownload } from '@/lib/download';
import {
  fetchFilteredTraces,
  tracesToCsv,
  tracesToJson,
  EXPORT_CAP,
  type ExportTrace,
} from '@/lib/traces-export';
import { LensTraceDetail } from './trace-detail';

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

interface Trace {
  traceId: string;
  name?: string;
  status?: string;
  statusCode?: string;
  model?: string;
  startTimeUnixNano?: string;
}
interface TracesResult {
  traces: Trace[];
}
interface TagsResult {
  tags: string[];
}
interface SavedView {
  id: string;
  name: string;
  query_string: string;
}
interface SavedViewsResult {
  saved_views: SavedView[];
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
  const queryClient = useQueryClient();

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
  const [tag, setTag] = useState('');
  const [note, setNote] = useState('');
  const [pendingTag, setPendingTag] = useState<string | null>(null);

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
  // string (nuqs re-hydrates every filter); share = the URL itself.
  const [searchParams, setSearchParams] = useSearchParams();
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [pendingView, setPendingView] = useState<SavedView | null>(null);

  const savedViewsKey = ['cloud', '/v1/dashboard/lens/saved-views'] as const;
  const savedViews = useQuery({
    queryKey: savedViewsKey,
    queryFn: () => cloudFetch<SavedViewsResult>('/v1/dashboard/lens/saved-views'),
  });
  const invalidateViews = () => void queryClient.invalidateQueries({ queryKey: savedViewsKey });

  const createView = useMutation({
    mutationFn: (name: string) =>
      cloudFetch<SavedView>('/v1/dashboard/lens/saved-views', {
        method: 'POST',
        // the query string IS the view — the current filter URL (or a bare "?" when no filter is set).
        body: JSON.stringify({ name, query_string: searchParams.toString() ? `?${searchParams.toString()}` : '?' }),
      }),
    onSuccess: () => {
      setSaveOpen(false);
      setViewName('');
      invalidateViews();
    },
  });

  const deleteView = useMutation({
    mutationFn: (id: string) =>
      cloudFetch<unknown>(`/v1/dashboard/lens/saved-views/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      setPendingView(null);
      invalidateViews();
    },
  });

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

  const tagsKey = ['cloud', '/v1/dashboard/lens/traces', openID, 'tags'] as const;
  const tags = useQuery({
    queryKey: tagsKey,
    queryFn: () => cloudFetch<TagsResult>(`/v1/dashboard/lens/traces/${encodeURIComponent(openID as string)}/tags`),
    enabled: openID !== null,
  });
  const invalidateTags = () => void queryClient.invalidateQueries({ queryKey: tagsKey });

  const addTag = useMutation({
    mutationFn: (t: string) =>
      cloudFetch<TagsResult>(`/v1/dashboard/lens/traces/${encodeURIComponent(openID as string)}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tag: t }),
      }),
    onSuccess: () => {
      setTag('');
      invalidateTags();
    },
  });

  const removeTag = useMutation({
    mutationFn: (t: string) =>
      cloudFetch<TagsResult>(
        `/v1/dashboard/lens/traces/${encodeURIComponent(openID as string)}/tags?tag=${encodeURIComponent(t)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      setPendingTag(null);
      invalidateTags();
    },
  });

  const addAnnotation = useMutation({
    mutationFn: (n: string) =>
      cloudFetch<unknown>(`/v1/dashboard/lens/traces/${encodeURIComponent(openID as string)}/annotations`, {
        method: 'POST',
        body: JSON.stringify({ note: n }),
      }),
    onSuccess: () => setNote(''),
  });

  const columns: DataTableColumn<Trace>[] = [
    {
      key: 'compare-select',
      label: '',
      render: (row) => (
        <input
          type="checkbox"
          checked={selected.has(row.traceId)}
          onChange={() => toggleSelected(row.traceId)}
          aria-label={`Select ${row.traceId} for compare`}
          className="h-4 w-4 cursor-pointer"
        />
      ),
    },
    {
      key: 'timestamp',
      label: 'Time',
      render: (row) => {
        const iso = nsToIso(row.startTimeUnixNano);
        if (!iso) return <span className="text-muted-foreground">—</span>;
        return (
          <span
            className="text-xs whitespace-nowrap text-muted-foreground"
            title={formatDate(iso, 'datetime')}
          >
            {formatDate(iso, 'relative')}
          </span>
        );
      },
    },
    {
      key: 'traceId',
      label: 'Trace',
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpenID(row.traceId)}
            title={row.traceId}
            aria-label={`Open ${row.traceId}`}
          >
            <span className="font-mono text-sm">{shortId(row.traceId)}</span>
          </Button>
          <CopyButton value={row.traceId} label="Copy trace id" />
        </div>
      ),
    },
    { key: 'name', label: 'Name', render: (row) => <span>{row.name ?? '—'}</span> },
    { key: 'model', label: 'Model', render: (row) => <span className="font-mono text-xs">{row.model ?? '—'}</span> },
    {
      key: 'status',
      label: 'Status',
      render: (row) => {
        const s = row.statusCode ?? row.status;
        if (!s) return <span>—</span>;
        return <Badge variant={s.toLowerCase() === 'error' ? 'destructive' : 'outline'}>{s}</Badge>;
      },
    },
  ];

  const traces = query.data?.traces ?? [];
  const currentTags = tags.data?.tags ?? [];

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

          {/* M52 — saved views: apply / delete a stored filter combination, or save the current one. */}
          <div className="flex flex-wrap items-center gap-2" aria-label="Saved views">
            <span className="text-xs font-medium text-muted-foreground">Saved views:</span>
            {(savedViews.data?.saved_views ?? []).map((v) => (
              <span key={v.id} className="flex items-center gap-0.5">
                <Button variant="secondary" size="sm" onClick={() => applyView(v.query_string)} aria-label={`Apply view ${v.name}`}>
                  {v.name}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPendingView(v)} aria-label={`Delete view ${v.name}`}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </span>
            ))}
            {(savedViews.data?.saved_views ?? []).length === 0 ? (
              <span className="text-xs text-muted-foreground">none yet</span>
            ) : null}
            {saveOpen ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (viewName.trim()) createView.mutate(viewName.trim());
                }}
              >
                <Input
                  value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                  placeholder="View name"
                  aria-label="Saved view name"
                  className="w-[160px]"
                />
                <Button type="submit" size="sm" disabled={!viewName.trim() || createView.isPending}>
                  Save
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSaveOpen(false)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setSaveOpen(true)} aria-label="Save current view">
                <BookmarkPlus className="mr-1 h-3.5 w-3.5" />
                Save current view
              </Button>
            )}
          </div>

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
              <div className="mb-2 flex items-center justify-end gap-2">
                {selected.size > 0 ? (
                  <span className="text-xs text-muted-foreground">{selected.size} selected</span>
                ) : null}
                <Button variant="secondary" size="sm" disabled={exporting} onClick={() => doExport('csv')}>
                  <Download className="mr-1 h-4 w-4" />
                  Export CSV
                </Button>
                <Button variant="secondary" size="sm" disabled={exporting} onClick={() => doExport('json')}>
                  <Download className="mr-1 h-4 w-4" />
                  Export JSON
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={compareHref === undefined}
                  data-compare-href={compareHref}
                  onClick={() => compareHref && navigate(compareHref)}
                >
                  <GitCompareArrows className="mr-1 h-4 w-4" />
                  Compare
                </Button>
              </div>
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
                <DataTable columns={columns} data={traces} rowKey={(row) => row.traceId} />
              </Card>
            </>
          )}

          {openID !== null ? <LensTraceDetail key={openID} traceId={openID} /> : null}

          {openID !== null ? (
            <Card>
              <Card.Header>
                <h2 className="text-sm font-medium">Metadata · {openID}</h2>
                <Button variant="ghost" size="sm" onClick={() => setOpenID(null)} aria-label="Close metadata">
                  Close
                </Button>
              </Card.Header>
              <Card.Body>
                <div className="space-y-4">
                  <div>
                    <form
                      className="flex items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (tag.trim()) addTag.mutate(tag.trim());
                      }}
                    >
                      <div className="flex-1">
                        <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Add a tag" aria-label="New tag" />
                      </div>
                      <Button type="submit" disabled={!tag.trim() || addTag.isPending}>
                        Add tag
                      </Button>
                    </form>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {currentTags.map((t) => (
                        <li key={t} className="flex items-center gap-1">
                          <Badge variant="outline">{t}</Badge>
                          <Button variant="ghost" size="sm" onClick={() => setPendingTag(t)} aria-label={`Remove tag ${t}`}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (note.trim()) addAnnotation.mutate(note.trim());
                    }}
                  >
                    <div className="flex-1">
                      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an annotation note" aria-label="New annotation" />
                    </div>
                    <Button type="submit" disabled={!note.trim() || addAnnotation.isPending}>
                      Add note
                    </Button>
                  </form>
                </div>
              </Card.Body>
            </Card>
          ) : null}
        </div>
      </PageShell>

      {pendingTag !== null ? (
        <ConfirmDialog
          open={pendingTag !== null}
          onOpenChange={(o) => !o && setPendingTag(null)}
          title={`Remove tag "${pendingTag}"?`}
          description={<p className="text-sm">This removes the tag from the trace.</p>}
          confirmLabel={removeTag.isPending ? 'Removing…' : 'Remove tag'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={removeTag.isPending}
          onConfirm={() => removeTag.mutate(pendingTag)}
        />
      ) : null}

      {pendingView !== null ? (
        <ConfirmDialog
          open={pendingView !== null}
          onOpenChange={(o) => !o && setPendingView(null)}
          title={`Delete view "${pendingView.name}"?`}
          description={<p className="text-sm">This removes the saved view. Your current filters are unaffected.</p>}
          confirmLabel={deleteView.isPending ? 'Deleting…' : 'Delete view'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={deleteView.isPending}
          onConfirm={() => deleteView.mutate(pendingView.id)}
        />
      ) : null}
    </>
  );
}
