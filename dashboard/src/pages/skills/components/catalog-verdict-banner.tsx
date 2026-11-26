import { Card } from '@getloopscale/ui';
import type { CatalogVerdict } from '../catalog-verdict';

/**
 * O veredito do acervo, na tela (B-126).
 *
 * ## `role="status"`, e não `alert`
 *
 * A leitura terminou com sucesso; um `alert` interromperia a navegação de quem usa leitor de tela
 * para entregar contexto, e não urgência. Mesmo quando o veredito é `problem`, ele descreve um
 * estado do acervo — não um evento que acabou de acontecer.
 *
 * ## Por que a severidade está no TIPO e não na frase
 *
 * A lição do `B-111`: aquele item nasceu de um código que decidia comportamento lendo a mensagem
 * humana, e quebrou em silêncio no dia em que as frases mudaram. Aqui a cor vem de `kind`, e
 * traduzir a frase não muda nada.
 */
export function CatalogVerdictBanner({ veredito }: { readonly veredito: CatalogVerdict }) {
  const tom =
    veredito.kind === 'problem'
      ? 'text-warning'
      : veredito.kind === 'unknown'
        ? 'text-warning'
        : 'text-foreground';

  return (
    <Card className="mb-4">
      <Card.Body className="py-4">
        <p role="status" aria-label="Skill registry status">
          <span className={`text-sm font-medium ${tom}`}>{veredito.headline}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{veredito.detail}</span>
        </p>
      </Card.Body>
    </Card>
  );
}
