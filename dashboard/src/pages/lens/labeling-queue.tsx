import { lensErrorMessage } from '@/pages/lens/lens-error';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, CopyButton, DataTable, type DataTableColumn, Input, Label, StatusDot } from '@getloopscale/ui';
import { PageShell } from '@/components/ui/page-shell';
import { AppModal } from '@/components/ui/app-modal';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { shortId } from '@/lib/formatting/format';
import { usePaginacao } from '@/lib/pagination';
import { Pager } from '@/components/pager';
import {
  useLabelingQueue,
  useResolveQueueItem,
  useExportQueueAsDataset,
  type QueueItem,
} from '@/hooks/lens/use-labeling-queue';
import { SCORE_CONFIGS } from './labeling-queue/score-configs';
import { ResolveForm } from './labeling-queue/resolve-form';
import { prefillValues, toResolveBody, type AnnotationValues } from './labeling-queue/to-resolve-body';

/**
 * M63 — /observability/labeling-queue. The human-in-the-loop review queue (Arize screen 6). Lists the
 * workspace's labeling-queue items (server-paginated via `GET /v1/dashboard/lens/labeling-queue`),
 * opens a resolve Sheet (span context + a label/score/note form with real `<Label>`s) writing back via
 * `POST …/labeling-queue/{id}/resolve`, and exports resolved items as a golden dataset via
 * `POST …/labeling-queue/export-as-dataset` (reuses the M44 dataset store). Every write is Principal-
 * scoped upstream; a provider/scope error fails closed to a typed Alert (never a fabricated success).
 */



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

  const [active, setActive] = useState<QueueItem | null>(null);
  const [values, setValues] = useState<AnnotationValues>({});
  const [exporting, setExporting] = useState(false);
  const [exportName, setExportName] = useState('');

  // #labeling-queue-pager (M70) — the endpoint is server-paginated (returns total/page/pageSize) but
  // page 2+ was previously unreachable; drive `page` and render a Prev/Next pager + result count.
  const [page, setPage] = useState(1);
  const query = useLabelingQueue(page);
  const items = query.data?.items ?? [];
  // Q-3: exporting with zero resolved items produces an empty/partial golden dataset. Guard the export
  // on the resolved items in view (page-scoped — the payload carries no queue-wide resolved total).
  const resolvedCount = items.filter((i) => i.status === 'resolved').length;
  const total = query.data?.total ?? items.length;
  const pageSize = query.data?.pageSize ?? (items.length || 1);
  // B-184 — a aritmética e o passo-atrás de página fora-do-fim são de `usePaginacao`. Esta tela
  // era a ÚNICA das cinco que tinha a correção; agora as outras quatro a herdam daqui.
  const paginacao = usePaginacao({
    total,
    pageSize,
    page,
    setPage,
    // "Dados não assentados" inclui o estado anterior à primeira resposta: sem ele, um `data`
    // vazio no meio de uma navegação colapsaria `pageCount` para 1 e devolveria a página.
    notSettled: query.isFetching || !query.data,
  });

  const openResolve = (item: QueueItem) => {
    setActive(item);
    setValues(prefillValues(SCORE_CONFIGS, item));
  };
  const closeResolve = () => setActive(null);

  const body = toResolveBody(SCORE_CONFIGS, values);

  const resolve = useResolveQueueItem();
  const submitResolve = (item: QueueItem) =>
    resolve.mutate({ id: item.id, body }, { onSuccess: closeResolve });

  const exportMutation = useExportQueueAsDataset();
  const submitExport = () =>
    exportMutation.mutate(exportName.trim(), {
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
          <span data-testid="queue-count">{paginacao.resumo}</span>
          <Pager paginacao={paginacao} ocupado={query.isFetching} />
        </div>
      ) : null}

      {/* Resolve modal — span context + label/score/note form (centered, not lateral). */}
      <AppModal
        open={active !== null}
        onClose={closeResolve}
        size="lg"
        title="Resolve labeling item"
        description={
          active ? (
            <span className="font-mono text-xs">{`span ${shortId(active.spanId, 12)} · trace ${shortId(active.traceId, 12)}`}</span>
          ) : (
            ''
          )
        }
      >
        <ResolveForm
          values={values}
          onChange={setValues}
          canResolve={body.label.trim() !== ''}
          pending={resolve.isPending}
          error={resolve.isError ? errorMessage(resolve.error) : null}
          onCancel={closeResolve}
          onResolve={() => active && submitResolve(active)}
        />
      </AppModal>

      {/* Export modal — name the golden dataset (centered, not lateral). */}
      <AppModal
        open={exporting}
        onClose={() => setExporting(false)}
        size="sm"
        title="Export resolved items as a dataset"
        description="The resolved queue items become a golden dataset (reuses your datasets)."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setExporting(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!exportName.trim() || resolvedCount === 0 || exportMutation.isPending}
              onClick={submitExport}
            >
              {exportMutation.isPending ? 'Exporting…' : 'Export'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
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
        </div>
      </AppModal>
    </PageShell>
  );
}
