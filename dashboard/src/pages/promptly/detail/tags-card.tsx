import { Card } from '@usetheo/ui';
import type { MarcandoMutation } from './tipos';
import { Alert } from '@/components/ui/alert-guard';
import { Button } from '@usetheo/ui';

interface Props {
  tags: readonly string[];

  novaTag: string;
  setNovaTag: (v: string) => void;
  erroDeTag: string | null;
  marcando: MarcandoMutation;
}

/**
 * As tags do prompt — lidas E escritas aqui.
 *
 * A marcação é do PROMPT, não da revisão: creating the next revision does not lose it.
 *
 * ## Por que saiu do `detail.tsx` (B-009)
 *
 * A tela tinha 887 linhas num ÚNICO componente — nenhuma fronteira de função
 * para seguir. A divisão precisou ser DESENHADA, e o desenho veio dos cartões:
 * cada um responde uma pergunta própria e recebe entre um e seis símbolos.
 * Cortar por tamanho teria produzido metades sem nome.
 */
export function TagsCard({ novaTag, setNovaTag, erroDeTag, marcando, tags }: Props) {
  return (
    <Card>
      <Card.Header>
        <Card.Title asChild>
          <h2>Tags</h2>
        </Card.Title>
        <Card.Description>
          How this prompt is found in the catalog. Tagging belongs to the PROMPT, not the revision —
          creating the next revision does not lose it.
        </Card.Description>
      </Card.Header>
      <div className="space-y-3 p-4 pt-0">
        {erroDeTag !== null ? (
          <Alert intent="destructive" title="The tags were not saved" description={erroDeTag} />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {tags.length === 0 ? (
            // Dito, nunca em branco: um espaço vazio lê como "não carregou". A ausência é um
            // fato sobre o prompt — mesma razão do "sem descrição" do M17.
            <span className="text-sm text-muted-foreground">No tags on this prompt.</span>
          ) : (
            tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                {t}
                <button
                  type="button"
                  aria-label={`Remover a tag ${t}`}
                  disabled={marcando.isPending}
                  onClick={() => { marcando.mutate(tags.filter((x) => x !== t)); }}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={novaTag}
            onChange={(e) => { setNovaTag(e.target.value); }}
            aria-label="New tag"
            placeholder="suporte"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={novaTag.trim() === '' || marcando.isPending}
            onClick={() => {
              // O conjunto INTEIRO, nunca só a nova: o contrato do serviço é substituição, e
              // mandar só a tag nova apagaria as antigas do outro lado.
              const t = novaTag.trim();
              marcando.mutate(tags.includes(t) ? tags : [...tags, t]);
            }}
          >
            Marcar
          </Button>
        </div>
      </div>
    </Card>
  );
}
