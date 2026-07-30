import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, Upload } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  PageShell,
  Select,
  Skeleton,
  Textarea,
  Timestamp,
} from '@usetheo/ui';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch, cloudFetchRaw } from '@/lib/api';
import { ChunksPanel } from './chunks-panel';

// M11 — file types the engine ingests (PDF/office/CSV/text/image). The engine is the
// source of truth and returns a typed 422 for anything else; this drives the picker's
// `accept` + a friendly client-side pre-check. 10 MiB matches theo-rag's default cap.
const ACCEPTED_EXT = '.pdf,.docx,.pptx,.xlsx,.csv,.txt,.md,.html,.png,.jpg,.jpeg';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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
  const [chunksForDoc, setChunksForDoc] = useState<Document | null>(null);
  const [ingestMode, setIngestMode] = useState('fast');
  const [fileError, setFileError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const collectionsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/collections'] as const,
    queryFn: () => cloudFetch<{ items: Collection[] }>('/v1/dashboard/rag/collections', {}, { throwOnError: true }),
  });

  const docsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/documents', collectionID] as const,
    queryFn: () =>
      cloudFetch<{ items: Document[] }>(
        `/v1/dashboard/rag/documents?collection_id=${encodeURIComponent(collectionID)}`, {}, { throwOnError: true }),
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

  // M11 — file upload. Sends multipart via cloudFetchRaw so the browser sets the
  // multipart boundary itself (cloudFetch would force application/json). The engine
  // ingests async (202); a non-2xx surfaces the typed upstream reason.
  const uploadFile = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('collection_id', collectionID);
      form.append('mode', ingestMode);
      if (name.trim() !== '') form.append('name', name.trim());
      const resp = await cloudFetchRaw('/v1/dashboard/rag/documents/file', { method: 'POST', body: form });
      if (resp === null) return; // session expired — cloudFetchRaw redirected
      if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        throw new Error(detail || `upload failed (${resp.status})`);
      }
    },
    onSuccess: () => {
      setName('');
      setFileError('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      invalidate();
    },
  });

  const onFilePicked = (file: File | undefined) => {
    setFileError('');
    if (!file) return;
    if (collectionID === '') {
      setFileError('Select a collection first.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setFileError(`"${file.name}" is larger than 10 MB. Pick a smaller file.`);
      return;
    }
    uploadFile.mutate(file);
  };

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
      align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setChunksForDoc(row)}
            aria-label={`View chunks for ${row.name ?? row.id}`}
          >
            Chunks
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPendingDelete(row)} aria-label={`Delete ${row.id}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const collections = collectionsQuery.data?.items ?? [];
  const docs = docsQuery.data?.items ?? [];

  return (
    <>
      <PageShell title="Documents" description="Upload documents into a collection and track ingestion status.">
        <div className="space-y-6">
          {chunksForDoc ? (
            <ChunksPanel
              documentID={chunksForDoc.id}
              documentName={chunksForDoc.name ?? chunksForDoc.id}
              onClose={() => setChunksForDoc(null)}
            />
          ) : (
            <>
          <Card>
            <Card.Body>
              <div className="space-y-3">
                <Select value={collectionID} onValueChange={setCollectionID}>
                  <Select.Trigger className="w-full" aria-label="Collection">
                    <Select.Value placeholder="Select a collection…" />
                  </Select.Trigger>
                  <Select.Content>
                    {collections.map((c) => (
                      <Select.Item key={c.id} value={c.id}>
                        {c.name ?? c.id}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>

                {/* M11 — file upload (drag-drop or click). The primary ingest path.
                    Gated on a selected collection: the dropzone stays disabled until a
                    collection is chosen, so a user can never pick a file that the
                    "Select a collection first" guard would silently discard (the
                    "can't upload" dead-end). */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_EXT}
                  className="sr-only"
                  aria-label="Choose a file to upload"
                  disabled={collectionID === ''}
                  onChange={(e) => onFilePicked(e.target.files?.[0])}
                />
                <div
                  role="button"
                  tabIndex={collectionID === '' ? -1 : 0}
                  aria-label="Upload a document file"
                  aria-disabled={collectionID === ''}
                  onClick={() => {
                    if (collectionID === '') return;
                    fileInputRef.current?.click();
                  }}
                  onKeyDown={(e) => {
                    if (collectionID === '') return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  onDragOver={(e) => {
                    if (collectionID === '') return;
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    if (collectionID === '') return;
                    onFilePicked(e.dataTransfer.files?.[0]);
                  }}
                  className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors ${
                    collectionID === ''
                      ? 'cursor-not-allowed border-border opacity-60'
                      : dragOver
                        ? 'cursor-pointer border-primary bg-primary/5'
                        : 'cursor-pointer border-border hover:border-primary/50'
                  }`}
                >
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <div className="text-sm font-medium">
                    {collectionID === ''
                      ? 'Select a collection above to upload a file'
                      : uploadFile.isPending
                        ? 'Uploading…'
                        : 'Drop a file here, or click to browse'}
                  </div>
                  <div className="text-xs text-muted-foreground">PDF, Word, PowerPoint, Excel, CSV, text, or image · up to 10 MB</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Ingestion mode</span>
                  <Select value={ingestMode} onValueChange={setIngestMode}>
                    <Select.Trigger className="w-40" aria-label="Ingestion mode">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="fast">Fast (text)</Select.Item>
                      <Select.Item value="hi_res">Hi-res (scanned/complex)</Select.Item>
                    </Select.Content>
                  </Select>
                </div>
                {fileError !== '' ? (
                  <Alert intent="warning" title="Could not upload the file">
                    {fileError}
                  </Alert>
                ) : null}
                {uploadFile.isError ? (
                  <Alert intent="destructive" title="Upload failed">
                    {uploadFile.error instanceof Error ? uploadFile.error.message : 'Try again shortly.'}
                  </Alert>
                ) : null}

                <div className="flex items-center gap-3 pt-1">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">or paste text</span>
                  <div className="h-px flex-1 bg-border" />
                </div>

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
            <Alert intent="warning" title="Could not load documents">
              The RAG service is unavailable. Try again shortly.
            </Alert>
          ) : docs.length === 0 ? (
            <EmptyState title="No documents yet" description="Upload a document above to ingest it into this collection." />
          ) : (
            <Card>
              <DataTable columns={columns} data={docs} rowKey={(row) => row.id} />
            </Card>
          )}
            </>
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
