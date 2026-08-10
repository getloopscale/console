import { Card } from '@usetheo/ui';
import type { Ponteiros } from './tipos';
import { Badge, Button } from '@usetheo/ui';
import { LabelPointer } from '@/pages/promptly/components/projections';

interface Props {
  labelsFailed: boolean;
  setPromoteError: (v: string | null) => void;

  ponteiros: Ponteiros;
  latestVersion: number | null;
  setAlvo: (v: number | null) => void;
  setLabelAlvo: (v: string) => void;
}

/**
 * Os ambientes e para onde cada um aponta hoje.
 *
 * ## Por que saiu do `detail.tsx` (B-009)
 *
 * A tela tinha 887 linhas num ÚNICO componente — nenhuma fronteira de função
 * para seguir. A divisão precisou ser DESENHADA, e o desenho veio dos cartões:
 * cada um responde uma pergunta própria e recebe entre um e seis símbolos.
 * Cortar por tamanho teria produzido metades sem nome.
 */
export function AmbientesCard({ ponteiros, latestVersion, setAlvo, setLabelAlvo, labelsFailed, setPromoteError }: Props) {
  return (
    <Card>
      <Card.Header>
        <Card.Title asChild>
          <h2>Environments</h2>
        </Card.Title>
        <Card.Description>
          Which revision each label serves right now — and promotion to the{' '}
          <strong>latest</strong> revision, which is the common act. To promote an earlier
          revision, the table under <em>Content</em> has a per-row action.
        </Card.Description>
      </Card.Header>
      <div className="flex flex-wrap items-center gap-2 p-4 pt-0">
        {ponteiros.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            {labelsFailed
              ? 'No data — the read failed.'
              : 'No environment label points at this prompt.'}
          </span>
        ) : (
          ponteiros.map((p: LabelPointer) => (
            <span key={p.label} className="inline-flex items-center gap-1">
              {/* Texto, nunca só cor: o par label→revisão é o dado que a promoção altera. */}
              <Badge variant="outline">{`${p.label} → v${p.version}`}</Badge>
              {/* M21 DoD-3 — a AÇÃO, e não só a leitura.
                  O `/review` mediu que este cartão ficava fora das abas mas era somente leitura:
                  a promoção inteira vivia na tabela de revisões, que está na aba de conteúdo. O
                  teste que dizia cobrir o DoD-3 só verificava dois cabeçalhos, e passava com ZERO
                  botões — e o CHANGELOG afirmava publicamente o que a tela não fazia.
                  Promover a ÚLTIMA revisão é o ato comum; promover uma anterior continua na
                  tabela, e a descrição diz isso em vez de deixar o operador procurar. */}
              {latestVersion !== null && p.version !== latestVersion ? (
                <Button
                  size="sm"
                  variant="secondary"
                  // O rótulo diz "para a ÚLTIMA revisão", e não só o número: existem duas formas de promover
                  // na tela (esta e a da tabela por linha), e um rótulo idêntico as tornaria
                  // indistinguíveis para leitor de tela e para teste. A diferença não é cosmética —
                  // esta promove a última; aquela, a linha que o operador escolheu.
                  aria-label={`Promote ${p.label} to the latest revision, v${String(latestVersion)}`}
                  onClick={() => {
                    setPromoteError(null);
                    setLabelAlvo(p.label);
                    setAlvo(latestVersion);
                  }}
                >
                  → v{latestVersion}
                </Button>
              ) : null}
            </span>
          ))
        )}
      </div>
    </Card>
  );
}
