import { useState } from 'react';
import { Button, Card } from '@usetheo/ui';
import { copyToClipboard } from '@/lib/export/clipboard';
import {
  INTERFACES,
  gerarTrechoDeConsumo,
  type Alvo,
  type InterfaceDeConsumo,
} from '@/pages/promptly/components/consumo';

/**
 * M21 DoD-2 — *como consumir*, a aba de maior alcance e a mais barata.
 *
 * Hoje quem quer usar um prompt **sai da tela e vai ler o README do SDK**. Esta aba transforma o
 * catálogo de vitrine em ponto de partida: o trecho já aponta para ESTE prompt, com o ambiente que
 * ele serve e as variáveis que ele declara.
 *
 * A geração do texto vive em `components/promptly/consumo.ts`, fora do React. Aqui só há a moldura
 * — porque "o código roda" é propriedade da string, e afirmá-la sobre a árvore renderizada faria o
 * teste passar no dia em que o trecho quebrasse.
 */
export interface ConsumoTabProps {
  readonly alvo: Alvo | null;
  /** Falhou ao ler os ambientes? Então NÃO dá para dizer qual o trecho deve usar. */
  readonly ambientesIlegiveis: boolean;
  /**
   * Falhou ao ler o prompt? Então não há trecho — e "Carregando…" mentiria para sempre.
   *
   * Medido pelo `/review`: com HTTP 500 a aba ficava em "Carregando…" permanente, porque o alvo era
   * `null` e o componente não distinguia "ainda não chegou" de "não vai chegar".
   */
  readonly promptIlegivel: boolean;
}

export function ConsumoTab({ alvo, ambientesIlegiveis, promptIlegivel }: ConsumoTabProps) {
  const [copiada, setCopiada] = useState<InterfaceDeConsumo['id'] | null>(null);

  if (promptIlegivel) {
    return (
      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>How to consume</h2>
          </Card.Title>
        </Card.Header>
        <div className="p-4 pt-0">
          <p className="text-sm text-muted-foreground">
            Could not read this prompt, and without it there is no snippet to generate. Reload —
            a snippet built on missing data would point at the wrong place.
          </p>
        </div>
      </Card>
    );
  }

  if (ambientesIlegiveis) {
    // Sem saber quais ambientes este prompt serve, o gerador cairia para a versão — e entregaria
    // um trecho que CONGELA o consumidor numa revisão, silenciosamente, quando o certo seria o
    // ponteiro móvel. Um trecho errado é pior que trecho nenhum: ele é copiado.
    return (
      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>How to consume</h2>
          </Card.Title>
        </Card.Header>
        <div className="p-4 pt-0">
          <p className="text-sm text-muted-foreground">
            Could not read which environments this prompt serves, and without that the snippet
            would point at a fixed revision instead of the environment. Reload before copying.
          </p>
        </div>
      </Card>
    );
  }

  if (alvo === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>How to consume</h2>
          </Card.Title>
          <Card.Description>
            Each snippet already points at <strong>this</strong> prompt
            {alvo.label !== null ? (
              <>
                {' '}
                by the <code className="font-mono text-xs">{alvo.label}</code> environment — it
                follows the promotion, with nothing for you to republish.
                {!alvo.ambienteEProducao ? (
                  // A aba se chama "Como consumir" e o público é quem vai colar isto num serviço.
                  // Publicar `staging` sem dizer que não é produção é deixar supor o contrário.
                  <strong>
                    {' '}
                    Careful: this prompt does not serve production — the snippet points at{' '}
                    <code className="font-mono text-xs">{alvo.label}</code>.
                  </strong>
                ) : null}
              </>
            ) : (
              <>
                {' '}
                by version <code className="font-mono text-xs">v{alvo.ultimaVersao}</code>, because
                no environment points at it yet.
              </>
            )}
          </Card.Description>
        </Card.Header>
        <div className="space-y-4 p-4 pt-0">
          {INTERFACES.map((iface) => {
            const trecho = gerarTrechoDeConsumo(iface.id, alvo);
            return (
              <div key={iface.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{iface.rotulo}</h3>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Copy the ${iface.rotulo} snippet`}
                    onClick={() => {
                      // `writeText` pode falhar (permissão negada, contexto inseguro). Falhar em
                      // silêncio deixaria o operador colando o que estava antes na área de
                      // transferência — e concluindo que copiou este trecho.
                      // B-031 — mesmo motivo do live-url-hero: `navigator.clipboard`
                      // e undefined fora de contexto seguro, e o operador via a
                      // falha mesmo com o fallback de execCommand disponivel.
                      void copyToClipboard(trecho)
                        .then((ok) => {
                          if (!ok) throw new Error('copy failed');
                          setCopiada(iface.id);
                          // Volta a "Copiar": sem isto o rótulo fica preso, e o operador não
                          // distingue "copiei agora" de "copiei há dez minutos".
                          setTimeout(() => {
                            setCopiada((atual) => (atual === iface.id ? null : atual));
                          }, 2000);
                        })
                        .catch(() => {
                          setCopiada(null);
                        });
                    }}
                  >
                    {copiada === iface.id ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-mono text-xs">
                  {trecho}
                </pre>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
