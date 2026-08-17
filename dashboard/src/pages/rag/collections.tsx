import {
  useCollections,
  useCreateCollection,
  useDeleteCollection,
  type Collection,
} from '@/hooks/rag/use-collections';
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  PageShell,
  Skeleton,
  Timestamp,
} from '@usetheo/ui';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';

/**
 * M21 — /rag/collections. Create, list, and delete the workspace's RAG collections
 * via the read+write dashboard BFF (`/v1/dashboard/rag/collections`). Mirrors the
 * theo-memory dashboard's list + ConfirmDialog-delete pattern.
 */



export function RagCollectionsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('RAG · Collections'), [setPageTitle]);
  useRequireAuth();

  const [name, setName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Collection | null>(null);

  const query = useCollections();

  const create = useCreateCollection();
  const remove = useDeleteCollection();

  const columns: DataTableColumn<Collection>[] = [
    { key: 'name', label: 'Name', render: (row) => <span>{row.name ?? '—'}</span> },
    { key: 'id', label: 'ID', render: (row) => <span className="font-mono text-sm">{row.id}</span> },
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
        <Button variant="ghost" size="sm" onClick={() => setPendingDelete(row)} aria-label={`Delete ${row.id}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const items = query.data?.items ?? [];

  return (
    <>
      <PageShell title="Collections" description="Create and manage the collections documents are ingested into.">
        <div className="space-y-6">
          <Card>
            <Card.Body>
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) create.mutate(name.trim(), { onSuccess: () => setName('') });
                }}
              >
                <div className="flex-1">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="New collection name"
                    aria-label="New collection name"
                  />
                </div>
                <Button type="submit" disabled={!name.trim() || create.isPending}>
                  Create
                </Button>
              </form>
              {create.isError ? (
                <Alert intent="destructive" title="Could not create the collection" className="mt-3">
                  Try again shortly.
                </Alert>
              ) : null}
            </Card.Body>
          </Card>

          {query.isLoading ? (
            <Skeleton />
          ) : query.isError ? (
            <Alert intent="warning" title="Could not load collections">
              The RAG service is unavailable. Try again shortly.
            </Alert>
          ) : items.length === 0 ? (
            <EmptyState title="No collections yet" description="Create your first collection to start ingesting documents." />
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
          title={`Delete collection ${pendingDelete.name ?? pendingDelete.id}?`}
          description={
            <p className="text-sm">
              This permanently deletes the collection and all its documents. This cannot be undone.
            </p>
          }
          confirmLabel={remove.isPending ? 'Deleting…' : 'Delete collection'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={remove.isPending}
          onConfirm={async () => {
            await remove.mutateAsync(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      ) : null}
    </>
  );
}
