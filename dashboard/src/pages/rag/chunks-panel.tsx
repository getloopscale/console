import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Sheet, Skeleton, Textarea } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

import { cloudFetch } from '@/lib/api';

/**
 * chunk-editor — view a document's chunks and edit a chunk's text. On save the BFF
 * PATCHes theo-rag, which re-embeds the chunk server-side so retrieval reflects the
 * edit. Read = rag:read, edit = rag:write (gated at theo-rag). Destructive edit (no
 * history) by design for the dev tier.
 */

interface Chunk {
  id: string;
  index: number;
  text: string;
}

export function ChunksPanel({
  documentID,
  documentName,
  open,
  onOpenChange,
}: {
  documentID: string;
  documentName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const chunksQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/chunks', documentID] as const,
    queryFn: () =>
      cloudFetch<{ items: Chunk[] }>(`/v1/dashboard/rag/documents/${encodeURIComponent(documentID)}/chunks`),
    enabled: open && documentID !== '',
  });

  const save = useMutation({
    mutationFn: (chunk: Chunk) =>
      cloudFetch<{ id: string; reembedded: boolean }>(`/v1/dashboard/rag/chunks/${encodeURIComponent(chunk.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ text: draft }),
      }),
    onSuccess: () => {
      setEditingId(null);
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/rag/chunks', documentID] });
    },
  });

  const chunks = chunksQuery.data?.items ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <Sheet.Content side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-2xl">
        <Sheet.Header>
          <Sheet.Title className="pr-6">Chunks · {documentName}</Sheet.Title>
          <Sheet.Description>Edit a chunk&rsquo;s text and save to regenerate its embedding.</Sheet.Description>
        </Sheet.Header>
        <div className="space-y-3 py-4">
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
                        onClick={() => save.mutate(chunk)}
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
      </Sheet.Content>
    </Sheet>
  );
}
