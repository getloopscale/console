import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Input,
} from '@usetheo/ui';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';

import { cloudFetch } from '@/lib/http/api';

interface TagsResult {
  tags: string[];
}

export interface MetadataCardProps {
  /** The open trace's id — drives the tags/annotations reads + writes. */
  traceId: string;
  /** Close the metadata panel. */
  onClose: () => void;
}

/**
 * M44 tags + annotations metadata panel (extracted verbatim in M59 ADR D1). Reads the trace's
 * tags and lets the user author tags + annotation notes. Encapsulates its own react-query reads +
 * mutations + the remove-tag confirm dialog; the page passes the open trace id + a close callback.
 * Behavior-preserving in Phase 0 — still a Card (the Sheet swap is M59 Phase 1).
 */
export function MetadataCard({ traceId, onClose }: MetadataCardProps) {
  const queryClient = useQueryClient();
  const [tag, setTag] = useState('');
  const [note, setNote] = useState('');
  const [pendingTag, setPendingTag] = useState<string | null>(null);

  const tagsKey = ['cloud', '/v1/dashboard/lens/traces', traceId, 'tags'] as const;
  const tags = useQuery({
    queryKey: tagsKey,
    queryFn: () => cloudFetch<TagsResult>(`/v1/dashboard/lens/traces/${encodeURIComponent(traceId)}/tags`, {}, { throwOnError: true }),
  });
  const invalidateTags = () => void queryClient.invalidateQueries({ queryKey: tagsKey });

  const addTag = useMutation({
    mutationFn: (t: string) =>
      cloudFetch<TagsResult>(`/v1/dashboard/lens/traces/${encodeURIComponent(traceId)}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tag: t }),
      }),
    onSuccess: () => {
      setTag('');
      invalidateTags();
    },
  });

  const removeTag = useMutation({
    mutationFn: (t: string) =>
      cloudFetch<TagsResult>(
        `/v1/dashboard/lens/traces/${encodeURIComponent(traceId)}/tags?tag=${encodeURIComponent(t)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      setPendingTag(null);
      invalidateTags();
    },
  });

  const addAnnotation = useMutation({
    mutationFn: (n: string) =>
      cloudFetch<unknown>(`/v1/dashboard/lens/traces/${encodeURIComponent(traceId)}/annotations`, {
        method: 'POST',
        body: JSON.stringify({ note: n }),
      }),
    onSuccess: () => setNote(''),
  });

  const currentTags = tags.data?.tags ?? [];

  return (
    <>
      <Card>
        <Card.Header>
          <h2 className="text-sm font-medium">Metadata · {traceId}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close metadata">
            Close
          </Button>
        </Card.Header>
        <Card.Body>
          <div className="space-y-4">
            <div>
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (tag.trim()) addTag.mutate(tag.trim());
                }}
              >
                <div className="flex-1">
                  <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Add a tag" aria-label="New tag" />
                </div>
                <Button type="submit" variant="secondary" disabled={!tag.trim() || addTag.isPending}>
                  Add tag
                </Button>
              </form>
              <ul className="mt-3 flex flex-wrap gap-2">
                {currentTags.map((t) => (
                  <li key={t} className="flex items-center gap-1">
                    <Badge variant="outline">{t}</Badge>
                    <Button variant="ghost" size="sm" onClick={() => setPendingTag(t)} aria-label={`Remove tag ${t}`}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim()) addAnnotation.mutate(note.trim());
              }}
            >
              <div className="flex-1">
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an annotation note" aria-label="New annotation" />
              </div>
              <Button type="submit" variant="secondary" disabled={!note.trim() || addAnnotation.isPending}>
                Add note
              </Button>
            </form>
          </div>
        </Card.Body>
      </Card>

      {pendingTag !== null ? (
        <ConfirmDialog
          open={pendingTag !== null}
          onOpenChange={(o) => !o && setPendingTag(null)}
          title={`Remove tag "${pendingTag}"?`}
          description={<p className="text-sm">This removes the tag from the trace.</p>}
          confirmLabel={removeTag.isPending ? 'Removing…' : 'Remove tag'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={removeTag.isPending}
          onConfirm={() => removeTag.mutate(pendingTag)}
        />
      ) : null}
    </>
  );
}
