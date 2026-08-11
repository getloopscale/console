import { Card } from '@usetheo/ui';
import { comentarioRows } from '@/pages/promptly/components/projections';
import type { UseMutationResult } from '@tanstack/react-query';
import { Alert } from '@/components/ui/alert-guard';
import { Button } from '@usetheo/ui';

interface Props {
  comentando: UseMutationResult<unknown, unknown, string, unknown>;
  comentarios: ReturnType<typeof comentarioRows>;
  comentariosFalharam: boolean;
  erroDeComentario: string | null;
  novoComentario: string;
  setNovoComentario: (v: string) => void;

  revisaoDiscutida: number | null;
}

/**
 * A discussão de uma revisão (M18).
 *
 * Fica ACIMA de Ambientes porque quem promove precisa lê-la ANTES de
 * confirmar — a ordem da tela é a ordem da decisão.
 *
 * ## Por que saiu do `detail.tsx` (B-009)
 *
 * A tela tinha 887 linhas num ÚNICO componente — nenhuma fronteira de função
 * para seguir. A divisão precisou ser DESENHADA, e o desenho veio dos cartões:
 * cada um responde uma pergunta própria e recebe entre um e seis símbolos.
 * Cortar por tamanho teria produzido metades sem nome.
 */
export function DiscussaoCard({ revisaoDiscutida, comentando, comentarios, comentariosFalharam, erroDeComentario, novoComentario, setNovoComentario }: Props) {
  return (
    <Card>
      <Card.Header>
        <Card.Title asChild>
          <h2>Discussion {revisaoDiscutida !== null ? `on v${String(revisaoDiscutida)}` : ''}</h2>
        </Card.Title>
        <Card.Description>
          Why this revision exists, was rejected, or is ready. A comment belongs to the
          REVISION — creating the next one does not move it.
        </Card.Description>
      </Card.Header>
      <div className="space-y-3 p-4 pt-0">
        {comentariosFalharam ? (
          <Alert
            intent="destructive"
            title="Could not read the discussion"
            description="The absence below is ignorance, not silence: there may be comments this screen failed to load."
          />
        ) : null}
        {erroDeComentario !== null ? (
          <Alert intent="destructive" title="The comment was not saved" description={erroDeComentario} />
        ) : null}
        {comentarios.length === 0 && !comentariosFalharam ? (
          <p className="text-sm text-muted-foreground">No comments on this revision.</p>
        ) : (
          <ul className="space-y-2">
            {comentarios.map((c) => (
              <li key={c.id} className="rounded-md border p-3 text-sm">
                <p className="whitespace-pre-wrap">{c.body}</p>
                <p className="pt-1 text-xs text-muted-foreground">
                  {/* Autor ausente é DITO: uma credencial sem identidade humana não tem autor,
                      e inventar um apareceria numa auditoria como fato. */}
                  {c.author ?? 'author not recorded'}{c.quando === '' ? '' : ` · ${c.quando}`}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-start gap-2">
          <textarea
            value={novoComentario}
            onChange={(e) => { setNovoComentario(e.target.value); }}
            aria-label="Comment on this revision"
            placeholder="why this revision exists, or why it should not go live"
            rows={2}
            className="min-w-[18rem] flex-1 rounded-md border border-input bg-background p-2 text-sm"
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={novoComentario.trim() === '' || comentando.isPending || revisaoDiscutida === null}
            onClick={() => { comentando.mutate(novoComentario.trim()); }}
          >
            Comentar
          </Button>
        </div>
      </div>
    </Card>
  );
}
