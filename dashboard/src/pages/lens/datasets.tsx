import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  Label,
  PageShell,
  Skeleton,
  Timestamp,
} from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * M44 — /lens/datasets. List / create datasets and remove items via the read+write lens
 * management BFF (`/v1/dashboard/lens/datasets`). Mirrors the theo-rag collections page. The
 * BFF passes theo-lens's shape through verbatim, so the types match theo-lens: datasets carry
 * {id,name,createdAt,itemCount}; the detail carries {items:[{traceId}]}.
 */

interface Dataset {
  id: string;
  name: string;
  createdAt?: string;
  itemCount?: number;
}
interface DatasetsResult {
  datasets: Dataset[];
}
interface DatasetItem {
  traceId: string;
  createdAt?: string;
}
interface DatasetDetail {
  id: string;
  name: string;
  items: DatasetItem[];
}

export function LensDatasetsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Datasets'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [openID, setOpenID] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{ datasetID: string; traceId: string } | null>(null);

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/datasets'] as const,
    queryFn: () => cloudFetch<DatasetsResult>('/v1/dashboard/lens/datasets'),
  });

  const detail = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/datasets', openID] as const,
    // throwOnError so a failed detail load REJECTS (detail.isError) instead of resolving to null —
    // otherwise a load error is indistinguishable from an empty dataset and renders as "No items".
    queryFn: () => cloudFetch<DatasetDetail>(`/v1/dashboard/lens/datasets/${encodeURIComponent(openID as string)}`, {}, { throwOnError: true }),
    enabled: openID !== null,
    retry: false,
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/datasets'] });

  const create = useMutation({
    mutationFn: (n: string) =>
      cloudFetch<Dataset>('/v1/dashboard/lens/datasets', {
        method: 'POST',
        body: JSON.stringify({ name: n }),
      }),
    onSuccess: () => {
      setName('');
      invalidate();
    },
  });

  const removeItem = useMutation({
    mutationFn: (r: { datasetID: string; traceId: string }) =>
      cloudFetch<DatasetDetail>(
        `/v1/dashboard/lens/datasets/${encodeURIComponent(r.datasetID)}/items/${encodeURIComponent(r.traceId)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      setPendingRemove(null);
      void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/datasets', openID] });
      invalidate();
    },
  });

  const columns: DataTableColumn<Dataset>[] = [
    {
      key: 'name',
      label: 'Name',
      render: (row) => (
        <Button variant="ghost" size="sm" onClick={() => setOpenID(row.id)} aria-label={`Open ${row.name}`}>
          {row.name}
        </Button>
      ),
    },
    // An absent count is unknown → em-dash; a real 0 stays 0 (an empty-but-loaded dataset).
    { key: 'itemCount', label: 'Items', render: (row) => <span>{row.itemCount != null ? row.itemCount : '—'}</span> },
    {
      key: 'createdAt',
      label: 'Created',
      render: (row) => (row.createdAt ? <Timestamp value={row.createdAt} /> : <span>—</span>),
    },
  ];

  // Managed dataset-item rows (traceId + remove action) rendered via DataTable (M46 — mirrors
  // rag/collections; managed rows with a mutation use DataTable, not a native list). `datasetID` is
  // the open dataset (non-null while the items panel is shown).
  const itemColumns = (datasetID: string): DataTableColumn<DatasetItem>[] => [
    { key: 'traceId', label: 'Trace', render: (row) => <span className="font-mono text-sm">{row.traceId}</span> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPendingRemove({ datasetID, traceId: row.traceId })}
          aria-label={`Remove ${row.traceId}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const datasets = query.data?.datasets ?? [];

  return (
    <>
      <PageShell title="Datasets" description="Curate trace datasets for evaluation.">
        <div className="space-y-6">
          <Card>
            <Card.Body>
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) create.mutate(name.trim());
                }}
              >
                <div className="flex-1">
                  <Label htmlFor="dataset-name">Dataset name</Label>
                  <Input
                    id="dataset-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="New dataset name"
                  />
                </div>
                <Button type="submit" disabled={!name.trim() || create.isPending}>
                  Create
                </Button>
              </form>
              {create.isError ? (
                <Alert intent="destructive" title="Could not create the dataset" className="mt-3">
                  Try again shortly.
                </Alert>
              ) : null}
            </Card.Body>
          </Card>

          {query.isLoading ? (
            <Skeleton />
          ) : query.isError ? (
            <Alert intent="warning" title="Could not load datasets">
              The lens service is unavailable. Try again shortly.
            </Alert>
          ) : datasets.length === 0 ? (
            <EmptyState title="No datasets yet" description="Create your first dataset to start curating traces." />
          ) : (
            <Card>
              <DataTable columns={columns} data={datasets} rowKey={(row) => row.id} />
            </Card>
          )}

          {openID !== null ? (
            <Card>
              <Card.Header>
                <h2 className="text-sm font-medium">Items</h2>
                <Button variant="ghost" size="sm" onClick={() => setOpenID(null)} aria-label="Close items">
                  Close
                </Button>
              </Card.Header>
              <Card.Body>
                {detail.isLoading ? (
                  <Skeleton />
                ) : detail.isError ? (
                  <Alert intent="destructive" title="Could not load items" description="The dataset items failed to load. Retry, or check your access to this dataset." />
                ) : (detail.data?.items ?? []).length === 0 ? (
                  <EmptyState title="No items" description="Add traces to this dataset from the Traces page." />
                ) : (
                  <DataTable
                    columns={itemColumns(openID)}
                    data={detail.data?.items ?? []}
                    rowKey={(row) => row.traceId}
                  />
                )}
              </Card.Body>
            </Card>
          ) : null}
        </div>
      </PageShell>

      {pendingRemove ? (
        <ConfirmDialog
          open={pendingRemove !== null}
          onOpenChange={(o) => !o && setPendingRemove(null)}
          title={`Remove ${pendingRemove.traceId} from the dataset?`}
          description={<p className="text-sm">This removes the trace from this dataset. This cannot be undone.</p>}
          confirmLabel={removeItem.isPending ? 'Removing…' : 'Remove item'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={removeItem.isPending}
          onConfirm={() => removeItem.mutate(pendingRemove)}
        />
      ) : null}
    </>
  );
}
