import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Input,
} from '@getloopscale/ui';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';

import {
  useTraceTags,
  useAddTraceTag,
  useRemoveTraceTag,
  useAddTraceAnnotation,
} from '@/hooks/lens/use-trace-metadata';

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
  const [tag, setTag] = useState('');
  const [note, setNote] = useState('');
  const [pendingTag, setPendingTag] = useState<string | null>(null);

  const tags = useTraceTags(traceId);

  const addTag = useAddTraceTag(traceId);

  const removeTag = useRemoveTraceTag(traceId);

  const addAnnotation = useAddTraceAnnotation(traceId);

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
                  // O `setTag('')` vive AQUI e não num `onSuccess` do hook porque limpar o campo
                  // é decisão da tela, não do endpoint. E ele só roda no sucesso: uma etiqueta
                  // recusada mantém o que o usuário digitou, em vez de limpar e não salvar.
                  if (tag.trim()) addTag.mutate(tag.trim(), { onSuccess: () => { setTag(''); } });
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
                // Idem, e aqui custa mais: a nota é TEXTO QUE O USUÁRIO ESCREVEU. Limpar antes de
                // saber que salvou destrói trabalho sem erro e sem rascunho a recuperar.
                if (note.trim()) addAnnotation.mutate(note.trim(), { onSuccess: () => { setNote(''); } });
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
          onConfirm={async () => {
            // `mutateAsync`, não `mutate`: o `ConfirmDialog` dá `await` no `onConfirm` e só assim
            // uma recusa o mantém aberto com o motivo (B-105). Com `mutate` a rejeição é engolida
            // e o diálogo fecha sobre uma remoção que não aconteceu.
            await removeTag.mutateAsync(pendingTag);
            setPendingTag(null);
          }}
        />
      ) : null}
    </>
  );
}
