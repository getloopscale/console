import { useState } from 'react';
import { Button, Card } from '@usetheo/ui';
import {
  INTERFACES,
  gerarTrechoDeConsumo,
  type Alvo,
  type InterfaceDeConsumo,
} from '@/components/promptly/consumo';

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
}

export function ConsumoTab({ alvo, ambientesIlegiveis }: ConsumoTabProps) {
  const [copiada, setCopiada] = useState<InterfaceDeConsumo['id'] | null>(null);

  if (ambientesIlegiveis) {
    // Sem saber quais ambientes este prompt serve, o gerador cairia para a versão — e entregaria
    // um trecho que CONGELA o consumidor numa revisão, silenciosamente, quando o certo seria o
    // ponteiro móvel. Um trecho errado é pior que trecho nenhum: ele é copiado.
    return (
      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Como consumir</h2>
          </Card.Title>
        </Card.Header>
        <div className="p-4 pt-0">
          <p className="text-sm text-muted-foreground">
            Não foi possível ler quais ambientes este prompt serve, e sem isso o trecho apontaria
            para uma revisão fixa em vez do ambiente. Recarregue antes de copiar.
          </p>
        </div>
      </Card>
    );
  }

  if (alvo === null) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Como consumir</h2>
          </Card.Title>
          <Card.Description>
            Cada trecho já aponta para <strong>este</strong> prompt
            {alvo.label !== null ? (
              <>
                {' '}
                pelo ambiente <code className="font-mono text-xs">{alvo.label}</code> — ele acompanha
                a promoção, sem você republicar nada.
              </>
            ) : (
              <>
                {' '}
                pela versão <code className="font-mono text-xs">v{alvo.ultimaVersao}</code>, porque
                nenhum ambiente aponta para ele ainda.
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
                    aria-label={`Copiar o trecho ${iface.rotulo}`}
                    onClick={() => {
                      // `writeText` pode falhar (permissão negada, contexto inseguro). Falhar em
                      // silêncio deixaria o operador colando o que estava antes na área de
                      // transferência — e concluindo que copiou este trecho.
                      void navigator.clipboard
                        .writeText(trecho)
                        .then(() => {
                          setCopiada(iface.id);
                        })
                        .catch(() => {
                          setCopiada(null);
                        });
                    }}
                  >
                    {copiada === iface.id ? 'Copiado' : 'Copiar'}
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
