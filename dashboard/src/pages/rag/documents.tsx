import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Skeleton,
  Textarea,
  Timestamp,
} from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * M21 — /rag/documents. Upload (text ingest → async status), list, and delete a
 * collection's documents via the read+write dashboard BFF. Ingest is async at
 * theo-rag (202); the list polls so status transitions (processing → ready/failed)
 * are surfaced — never a fake "done".
 */

interface Collection {
  id: string;
  name: string | null;
}
interface Document {
  id: string;
  name?: string;
  status?: string;
  created_at?: string;
}

function statusVariant(status?: string): 'success' | 'destructive' | 'outline' {
  if (status === 'ready') return 'success';
  if (status === 'failed') return 'destructive';
  return 'outline';
}

export function RagDocumentsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('RAG · Documents'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [collectionID, setCollectionID] = useState('');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Document | null>(null);

  const collectionsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/collections'] as const,
    queryFn: () => cloudFetch<{ items: Collection[] }>('/v1/dashboard/rag/collections'),
  });

  const docsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/documents', collectionID] as const,
    queryFn: () =>
      cloudFetch<{ items: Document[] }>(
        `/v1/dashboard/rag/documents?collection_id=${encodeURIComponent(collectionID)}`,
      ),
    enabled: collectionID !== '',
    // Poll while any document is still ingesting so status transitions surface.
    refetchInterval: (q) =>
      (q.state.data?.items ?? []).some((d) => d.status !== 'ready' && d.status !== 'failed') ? 3000 : false,
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/rag/documents', collectionID] });

  const upload = useMutation({
    mutationFn: () =>
      cloudFetch<{ id: string }>('/v1/dashboard/rag/documents', {
        method: 'POST',
        body: JSON.stringify({ collection_id: collectionID, text, name: name || undefined }),
      }),
    onSuccess: () => {
      setText('');
      setName('');
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (d: Document) =>
      cloudFetch<null>(`/v1/dashboard/rag/documents/${encodeURIComponent(d.id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
    },
  });

  const columns: DataTableColumn<Document>[] = [
    { key: 'name', label: 'Name', render: (row) => <span>{row.name ?? row.id}</span> },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <Badge variant={statusVariant(row.status)}>{row.status ?? 'processing'}</Badge>,
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (row) => (row.created_at ? <Timestamp value={row.created_at} /> : <span>—</span>),
    },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <Button variant="ghost" size="sm" onClick={() => setPendingDelete(row)} aria-label={`Delete ${row.id}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const collections = collectionsQuery.data?.items ?? [];
  const docs = docsQuery.data?.items ?? [];

  return (
    <>
      <PageShell title="RAG Documents" description="Upload documents into a collection and track ingestion status.">
        <div className="space-y-6">
          <Card>
            <Card.Body>
              <div className="space-y-3">
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={collectionID}
                  onChange={(e) => setCollectionID(e.target.value)}
                  aria-label="Collection"
                >
                  <option value="">Select a collection…</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name ?? c.id}
                    </option>
                  ))}
                </select>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Document name (optional)"
                  aria-label="Document name"
                />
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste the document text to ingest…"
                  aria-label="Document text"
                  rows={5}
                />
                <div className="flex justify-end">
                  <Button
                    disabled={collectionID === '' || text.trim() === '' || upload.isPending}
                    onClick={() => upload.mutate()}
                  >
                    Upload &amp; ingest
                  </Button>
                </div>
                {upload.isError ? (
                  <Alert intent="destructive" title="Could not ingest the document">
                    Try again shortly.
                  </Alert>
                ) : null}
              </div>
            </Card.Body>
          </Card>

          {collectionID === '' ? (
            <EmptyState title="Pick a collection" description="Select a collection above to see its documents." />
          ) : docsQuery.isLoading ? (
            <Skeleton />
          ) : docsQuery.isError ? (
            <Alert intent="destructive" title="Could not load documents">
              The RAG service is unavailable. Try again shortly.
            </Alert>
          ) : docs.length === 0 ? (
            <EmptyState title="No documents yet" description="Upload a document above to ingest it into this collection." />
          ) : (
            <Card>
              <DataTable columns={columns} data={docs} rowKey={(row) => row.id} />
            </Card>
          )}
        </div>
      </PageShell>

      {pendingDelete ? (
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          title={`Delete document ${pendingDelete.name ?? pendingDelete.id}?`}
          description={<p className="text-sm">This permanently deletes the document and its chunks. This cannot be undone.</p>}
          confirmLabel={remove.isPending ? 'Deleting…' : 'Delete document'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={remove.isPending}
          onConfirm={() => remove.mutate(pendingDelete)}
        />
      ) : null}
    </>
  );
}
