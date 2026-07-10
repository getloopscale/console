import { lensErrorMessage } from '../../lib/lens-error';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge, Button, CopyButton, DataTable, type DataTableColumn, Input, Label, PageShell, Sheet, StatusDot, Textarea } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { shortId } from '@/lib/format';
import { cloudFetch } from '@/lib/api';

/**
 * M63 — /observability/labeling-queue. The human-in-the-loop review queue (Arize screen 6). Lists the
 * workspace's labeling-queue items (server-paginated via `GET /v1/dashboard/lens/labeling-queue`),
 * opens a resolve Sheet (span context + a label/score/note form with real `<Label>`s) writing back via
 * `POST …/labeling-queue/{id}/resolve`, and exports resolved items as a golden dataset via
 * `POST …/labeling-queue/export-as-dataset` (reuses the M44 dataset store). Every write is Principal-
 * scoped upstream; a provider/scope error fails closed to a typed Alert (never a fabricated success).
 */

interface QueueItem {
  id: string;
  traceId: string;
  spanId: string;
  status: 'pending' | 'resolved';
  label?: string;
  score?: number;
  note?: string;
  createdBy: string;
  resolvedBy?: string;
  createdAt: string;
  resolvedAt?: string;
}
interface QueuePage {
  items: QueueItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** Map a fail-closed HTTP status to an honest, typed message (duck-typed `.status`). */
function errorMessage(err: unknown): string {
  return lensErrorMessage(
    err,
    {
      403: 'You do not have permission to write to this workspace.',
      404: 'This item is not available (it may belong to another workspace).',
      400: 'A non-empty label is required to resolve.',
    },
    'Could not save — try again shortly.',
  );
}

export function LensLabelingQueuePage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Labeling Queue'), [setPageTitle]);
  useRequireAuth();
  const qc = useQueryClient();

  const [active, setActive] = useState<QueueItem | null>(null);
  const [label, setLabel] = useState('');
  const [score, setScore] = useState('');
  const [note, setNote] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportName, setExportName] = useState('');

  // #labeling-queue-pager (M70) — the endpoint is server-paginated (returns total/page/pageSize) but
  // page 2+ was previously unreachable; drive `page` and render a Prev/Next pager + result count.
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/labeling-queue', page] as const,
    queryFn: () => cloudFetch<QueuePage>(`/v1/dashboard/lens/labeling-queue?page=${page}`),
  });
  const items = query.data?.items ?? [];
  // Q-3: exporting with zero resolved items produces an empty/partial golden dataset. Guard the export
  // on the resolved items in view (page-scoped — the payload carries no queue-wide resolved total).
  const resolvedCount = items.filter((i) => i.status === 'resolved').length;
  const total = query.data?.total ?? items.length;
  const pageSize = query.data?.pageSize ?? (items.length || 1);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstShown = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(page * pageSize, total);

  // If resolving/exporting shrinks the queue below the current page, step back so the user never
  // lands on an empty out-of-range page. Guarded on settled data (`!isFetching` + data present) so a
  // mid-navigation empty `data` doesn't transiently collapse pageCount to 1 and bounce the page back.
  useEffect(() => {
    if (query.data && !query.isFetching && page > pageCount) setPage(pageCount);
  }, [page, pageCount, query.data, query.isFetching]);

  const openResolve = (item: QueueItem) => {
    setActive(item);
    setLabel(item.label ?? '');
    setScore(item.score !== undefined ? String(item.score) : '');
    setNote(item.note ?? '');
  };
  const closeResolve = () => setActive(null);

  const resolve = useMutation({
    mutationFn: (item: QueueItem) =>
      cloudFetch(
        `/v1/dashboard/lens/labeling-queue/${encodeURIComponent(item.id)}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify({
            label: label.trim(),
            ...(score.trim() !== '' && Number.isFinite(Number(score)) ? { score: Number(score) } : {}),
            ...(note.trim() !== '' ? { note: note.trim() } : {}),
          }),
        },
        { throwOnError: true },
      ),
    retry: false,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/labeling-queue'] });
      closeResolve();
    },
  });

  const exportMutation = useMutation({
    mutationFn: () =>
      cloudFetch(
        '/v1/dashboard/lens/labeling-queue/export-as-dataset',
        { method: 'POST', body: JSON.stringify({ name: exportName.trim() }) },
        { throwOnError: true },
      ),
    retry: false,
    onSuccess: () => {
      setExporting(false);
      setExportName('');
    },
  });

  const columns: DataTableColumn<QueueItem>[] = [
    {
      key: 'spanId',
      label: 'Span',
      render: (row) => (
        <div className="flex items-center gap-1">
          <span className="font-mono text-sm" title={row.spanId}>
            {row.spanId}
          </span>
          <CopyButton value={row.spanId} label="Copy span id" />
        </div>
      ),
    },
    {
      key: 'traceId',
      label: 'Trace',
      // Q-2: the trace id links to its source trace (the URL-addressable peek on the Traces page),
      // instead of being dead text.
      render: (row) => (
        <Link
          to={`/observability/traces?trace=${encodeURIComponent(row.traceId)}`}
          className="font-mono text-xs text-primary underline underline-offset-2"
          title={`Open trace ${row.traceId}`}
          aria-label={`Open trace ${row.traceId}`}
        >
          {shortId(row.traceId)}
        </Link>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <span className="flex items-center gap-1 text-sm">
          <StatusDot status={row.status === 'resolved' ? 'live' : 'idle'} size="xs" />
          {row.status === 'resolved' ? 'resolved' : 'pending'}
        </span>
      ),
    },
    { key: 'label', label: 'Label', render: (row) => <span>{row.label ?? '—'}</span> },
    {
      key: 'id',
      label: '',
      render: (row) => (
        <Button variant="secondary" size="sm" aria-label={`Review ${row.spanId}`} onClick={() => openResolve(row)}>
          {row.status === 'resolved' ? 'Edit' : 'Review'}
        </Button>
      ),
    },
  ];

  return (
    <PageShell
      title="Labeling Queue"
      description="Review enqueued spans, resolve them with a label, and export the resolved set as a golden dataset."
      primaryAction={{ label: 'Export as dataset', onClick: () => setExporting(true) }}
      loading={query.isLoading}
      error={query.isError ? { message: 'The labeling queue could not be loaded — try again shortly.', onRetry: () => void query.refetch() } : undefined}
      empty={
        items.length === 0
          ? { title: 'Nothing to review yet', description: 'Add a span to the labeling queue from its trace detail to start a review.' }
          : undefined
      }
    >
      <DataTable data={items} columns={columns} rowKey={(row) => row.id} />

      {/* Result count + pager — page 2+ is now reachable (was a dead-end). */}
      {total > 0 ? (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span data-testid="queue-count">{`Showing ${firstShown}–${lastShown} of ${total}`}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={page <= 1 || query.isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </Button>
            <span className="tabular-nums">{`Page ${page} / ${pageCount}`}</span>
            <Button variant="ghost" size="sm" disabled={page >= pageCount || query.isFetching} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      ) : null}

      {/* Resolve Sheet — span context + label/score/note form. */}
      <Sheet open={active !== null} onOpenChange={(open) => !open && closeResolve()}>
        <Sheet.Content side="right" className="w-full sm:max-w-lg">
          <Sheet.Header className="border-b border-border px-6 py-4">
            <Sheet.Title>Resolve labeling item</Sheet.Title>
            <Sheet.Description className="font-mono text-xs">
              {active ? `span ${shortId(active.spanId, 12)} · trace ${shortId(active.traceId, 12)}` : ''}
            </Sheet.Description>
          </Sheet.Header>
          <Sheet.Body className="space-y-4 px-6 py-5">
            <div className="space-y-1">
              <Label htmlFor="resolve-label">Label</Label>
              <Input id="resolve-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. good / bad / needs-fix" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="resolve-score">Score (0–1, optional)</Label>
              <Input id="resolve-score" value={score} onChange={(e) => setScore(e.target.value)} placeholder="0.9" inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="resolve-note">Note (optional)</Label>
              <Textarea id="resolve-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[80px]" />
            </div>
            {resolve.isError ? (
              <Alert intent="warning" title="Could not resolve" data-testid="resolve-error">
                {errorMessage(resolve.error)}
              </Alert>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={closeResolve}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!label.trim() || resolve.isPending}
                onClick={() => active && resolve.mutate(active)}
              >
                {resolve.isPending ? 'Resolving…' : 'Resolve'}
              </Button>
            </div>
          </Sheet.Body>
        </Sheet.Content>
      </Sheet>

      {/* Export Sheet — name the golden dataset. */}
      <Sheet open={exporting} onOpenChange={(open) => !open && setExporting(false)}>
        <Sheet.Content side="right" className="w-full sm:max-w-md">
          <Sheet.Header className="border-b border-border px-6 py-4">
            <Sheet.Title>Export resolved items as a dataset</Sheet.Title>
            <Sheet.Description>The resolved queue items become a golden dataset (reuses your datasets).</Sheet.Description>
          </Sheet.Header>
          <Sheet.Body className="space-y-4 px-6 py-5">
            <div className="space-y-1">
              <Label htmlFor="export-name">Dataset name</Label>
              <Input id="export-name" value={exportName} onChange={(e) => setExportName(e.target.value)} placeholder="golden-2026-07" />
            </div>
            {resolvedCount === 0 ? (
              <Alert intent="warning" title="No resolved items to export" data-testid="export-empty-guard">
                Resolve at least one item (add a label) before exporting — an export of zero resolved items
                would produce an empty dataset.
              </Alert>
            ) : null}
            {exportMutation.isError ? (
              <Alert intent="warning" title="Could not export" data-testid="export-error">
                {errorMessage(exportMutation.error)}
              </Alert>
            ) : exportMutation.isSuccess ? (
              <Alert intent="success" title="Exported">
                <Badge variant="outline">golden dataset created</Badge>
              </Alert>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setExporting(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!exportName.trim() || resolvedCount === 0 || exportMutation.isPending}
                onClick={() => exportMutation.mutate()}
              >
                {exportMutation.isPending ? 'Exporting…' : 'Export'}
              </Button>
            </div>
          </Sheet.Body>
        </Sheet.Content>
      </Sheet>
    </PageShell>
  );
}
