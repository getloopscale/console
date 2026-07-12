import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Trash2 } from 'lucide-react';
import { Button, Card, ConfirmDialog, DataTable, type DataTableColumn, EmptyState, PageShell, Skeleton, Timestamp } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * #191 — /rag/connectors. See and manage the workspace's connector connections (list +
 * sync + delete) via the read+write dashboard BFF (`/v1/dashboard/rag/connectors`). Mirrors
 * the collections page. v1 is MANAGE-only; connecting a new source from the dashboard is a
 * follow-up (today: `POST /v1/connectors/{provider}/connect` via the CLI/API).
 */

interface Connection {
  id: string;
  provider_id: string;
  collection_id: string;
  status: string;
  created_at?: string;
}

interface ConnectionsResult {
  items: Connection[];
}

export function RagConnectorsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('RAG · Connectors'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [pendingDelete, setPendingDelete] = useState<Connection | null>(null);

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/connectors'] as const,
    queryFn: () => cloudFetch<ConnectionsResult>('/v1/dashboard/rag/connectors'),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/rag/connectors'] });

  const sync = useMutation({
    mutationFn: (c: Connection) =>
      cloudFetch<unknown>(`/v1/dashboard/rag/connectors/${encodeURIComponent(c.id)}/sync`, {
        method: 'POST',
      }),
    onSuccess: () => invalidate(),
  });

  const remove = useMutation({
    mutationFn: (c: Connection) =>
      cloudFetch<null>(`/v1/dashboard/rag/connectors/${encodeURIComponent(c.id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
    },
  });

  const columns: DataTableColumn<Connection>[] = [
    { key: 'provider_id', label: 'Provider', render: (row) => <span className="capitalize">{row.provider_id}</span> },
    { key: 'collection_id', label: 'Collection', render: (row) => <span className="font-mono text-sm">{row.collection_id}</span> },
    { key: 'status', label: 'Status', render: (row) => <span className="capitalize">{row.status}</span> },
    {
      key: 'created_at',
      label: 'Created',
      render: (row) => (row.created_at ? <Timestamp value={row.created_at} /> : <span>—</span>),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => sync.mutate(row)}
            disabled={sync.isPending}
            aria-label={`Sync ${row.id}`}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPendingDelete(row)} aria-label={`Delete ${row.id}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const items = query.data?.items ?? [];

  return (
    <>
      <PageShell title="Connectors" description="Sync and manage the data-source connections that ingest into your collections.">
        <div className="space-y-6">
          {sync.isError ? (
            <Alert intent="destructive" title="Could not start the sync">
              Try again shortly.
            </Alert>
          ) : null}
          {remove.isError ? (
            <Alert intent="destructive" title="Could not delete the connector">
              A sync may be in progress — try again shortly.
            </Alert>
          ) : null}

          {query.isLoading ? (
            <Skeleton />
          ) : query.isError ? (
            <Alert intent="warning" title="Could not load connectors">
              The RAG service is unavailable. Try again shortly.
            </Alert>
          ) : items.length === 0 ? (
            <EmptyState
              title="No connectors yet"
              description="Connect a data source with the CLI or API (POST /v1/connectors/{provider}/connect). Connecting from the dashboard is coming soon."
            />
          ) : (
            <Card>
              <DataTable columns={columns} data={items} rowKey={(row) => row.id} />
            </Card>
          )}
        </div>
      </PageShell>

      {pendingDelete ? (
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          title={`Delete the ${pendingDelete.provider_id} connector?`}
          description={
            <p className="text-sm">
              This removes the connection and its credentials. Already-ingested documents are kept. This cannot be undone.
            </p>
          }
          confirmLabel={remove.isPending ? 'Deleting…' : 'Delete connector'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={remove.isPending}
          onConfirm={() => remove.mutate(pendingDelete)}
        />
      ) : null}
    </>
  );
}
