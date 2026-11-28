import {
  useCollections,
  useCreateCollection,
  useDeleteCollection,
  type Collection,
} from '@/hooks/rag/use-collections';
import { useEffect, useState } from 'react';
import { FolderPlus, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  Label,
  Skeleton,
  Timestamp,
} from '@getloopscale/ui';
import { PageShell } from '@/components/ui/page-shell';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { AppModal } from '@/components/ui/app-modal';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';

/**
 * M21 — /rag/collections. Create, list, and delete the workspace's RAG collections
 * via the read+write dashboard BFF (`/v1/dashboard/rag/collections`). Mirrors the
 * loopmem dashboard's list + ConfirmDialog-delete pattern.
 */



export function RagCollectionsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('RAG · Collections'), [setPageTitle]);
  useRequireAuth();

  const [name, setName] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
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

  const closeCreate = () => {
    setCreateOpen(false);
    setName('');
    create.reset();
  };

  return (
    <>
      <PageShell
        title="Collections"
        description="Create and manage the collections documents are ingested into."
        primaryAction={{ label: 'New collection', icon: Plus, onClick: () => setCreateOpen(true) }}
      >
        <div className="space-y-6">
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

      <AppModal
        open={createOpen}
        onClose={closeCreate}
        title="New collection"
        description="Documents are ingested into a collection, and a search runs over one collection at a time."
        icon={<FolderPlus className="size-4" aria-hidden="true" />}
        size="sm"
        busy={create.isPending}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={closeCreate} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="new-collection-form" disabled={!name.trim() || create.isPending}>
              {create.isPending ? 'Creating…' : 'Create collection'}
            </Button>
          </>
        }
      >
        <form
          id="new-collection-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate(name.trim(), { onSuccess: closeCreate });
          }}
        >
          <div>
            <Label htmlFor="new-collection-name">Name</Label>
            <Input
              id="new-collection-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="product-docs"
              aria-label="New collection name"
            />
          </div>
          {create.isError ? (
            <Alert intent="destructive" title="Could not create the collection">
              Try again shortly.
            </Alert>
          ) : null}
        </form>
      </AppModal>

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
