import { useState } from 'react';
import { Badge, Button, Card, Skeleton, Textarea } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

import { useDocumentChunks, useSaveChunk, type Chunk } from '@/hooks/rag/use-chunks';

/**
 * chunk-editor — view a document's chunks and edit a chunk's text. On save the BFF
 * PATCHes theo-rag, which re-embeds the chunk server-side so retrieval reflects the
 * edit. Read = rag:read, edit = rag:write (gated at theo-rag). Destructive edit (no
 * history) by design for the dev tier.
 */


// KB4 — inline chunk editor (replaces the right-side Sheet slide-over).
export function ChunksPanel({
  documentID,
  documentName,
  onClose,
}: {
  documentID: string;
  documentName: string;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const chunksQuery = useDocumentChunks(documentID);

  const save = useSaveChunk(documentID);
  const submitSave = (chunk: Chunk) =>
    save.mutate(
      { id: chunk.id, text: draft },
      {
        onSuccess: () => {
          setEditingId(null);
          setDraft('');
        },
      },
    );

  const chunks = chunksQuery.data?.items ?? [];

  return (
    <Card>
      <Card.Body>
        <div className="mb-3 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Back to documents">
            ← Back
          </Button>
          <span className="truncate font-medium">Chunks · {documentName}</span>
        </div>
        <div className="space-y-3">
          {chunksQuery.isLoading ? (
            <Skeleton />
          ) : chunksQuery.isError ? (
            <Alert intent="warning" title="Could not load chunks">
              The RAG service is unavailable. Try again shortly.
            </Alert>
          ) : chunks.length === 0 ? (
            <p className="text-sm text-muted-foreground">This document has no chunks yet.</p>
          ) : (
            chunks.map((chunk) => (
              <div key={chunk.id} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <Badge variant="outline">#{chunk.index}</Badge>
                  {editingId === chunk.id ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit chunk ${chunk.index}`}
                      onClick={() => {
                        setEditingId(chunk.id);
                        setDraft(chunk.text);
                      }}
                    >
                      Edit
                    </Button>
                  )}
                </div>
                {editingId === chunk.id ? (
                  <div className="space-y-2">
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={5}
                      aria-label={`Chunk ${chunk.index} text`}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingId(null);
                          setDraft('');
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={draft.trim() === '' || draft === chunk.text || save.isPending}
                        onClick={() => submitSave(chunk)}
                      >
                        {save.isPending ? 'Re-embedding…' : 'Save & re-embed'}
                      </Button>
                    </div>
                    {save.isError ? (
                      <Alert intent="destructive" title="Could not save the chunk">
                        The chunk may have changed. Close and reopen to reload.
                      </Alert>
                    ) : null}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{chunk.text}</p>
                )}
              </div>
            ))
          )}
        </div>
      </Card.Body>
    </Card>
  );
}
