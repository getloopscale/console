import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsString, parseAsStringEnum } from 'nuqs';
import { Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
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
import { cloudFetch } from '@/lib/api';
import { LensTraceDetail } from './trace-detail';

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
}

/**
 * Build the `/v1/dashboard/lens/traces` query string from the active filters — active-only (empty /
 * `all` values are omitted so theo-lens sees only real filters), `range` → a `from` ISO timestamp.
 * `now` is injected (not `Date.now()` inline) so the helper is deterministic + unit-testable
 * (`.claude/rules/testing.md` — inject the clock).
 */
export function buildTraceQuery(f: TraceFilters, now: number): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.status === 'error') p.set('status', 'error');
  if (f.model.trim()) p.set('model', f.model.trim());
  if (f.range !== 'all') p.set('from', new Date(now - RANGE_MS[f.range]).toISOString());
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function LensTracesPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Traces'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [openID, setOpenID] = useState<string | null>(null);
  const [tag, setTag] = useState('');
  const [note, setNote] = useState('');
  const [pendingTag, setPendingTag] = useState<string | null>(null);

  // M49 — URL-persisted filters (nuqs): a filtered view is shareable/bookmarkable.
  const [q, setQ] = useQueryState('q', parseAsString.withDefault(''));
  const [status, setStatus] = useQueryState('status', parseAsStringEnum(['all', 'error']).withDefault('all'));
  const [model, setModel] = useQueryState('model', parseAsString.withDefault(''));
  const [range, setRange] = useQueryState('range', parseAsStringEnum([...RANGE_VALUES]).withDefault('all'));

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

  const filters: TraceFilters = { q, status, model, range };
  const hasActiveFilters = q.trim() !== '' || status !== 'all' || model.trim() !== '' || range !== 'all';

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
      key: 'traceId',
      label: 'Trace',
      render: (row) => (
        <Button variant="ghost" size="sm" onClick={() => setOpenID(row.traceId)} aria-label={`Open ${row.traceId}`}>
          <span className="font-mono text-sm">{row.traceId}</span>
        </Button>
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
                }}
                aria-label="Clear filters"
              >
                Clear
              </Button>
            ) : null}
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
            <Card>
              <DataTable columns={columns} data={traces} rowKey={(row) => row.traceId} />
            </Card>
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
    </>
  );
}
