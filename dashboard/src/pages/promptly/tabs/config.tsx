import { Card } from '@usetheo/ui';

/** A afinação declarada numa revisão (M17). */
export interface ModelConfigLido {
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface ConfigTabProps {
  readonly versao: number | null;
  readonly modelConfig: ModelConfigLido | null;
  readonly variaveis: readonly string[];
}

/**
 * M21 — *config*: com que afinação este prompt roda, e o que ele exige de quem o chama.
 *
 * São duas perguntas que a aba de conteúdo não responde e que hoje ficam escondidas numa coluna da
 * tabela de revisões: qual modelo e temperatura a revisão declara (M17), e quais variáveis ela
 * exige (o contrato de entrada).
 *
 * **A aba existe mesmo quando está vazia**, e isso é deliberado: esconder a aba faria a navegação
 * mudar de prompt para prompt, e o operador aprenderia que "às vezes tem config". Uma aba honesta e
 * curta é melhor que uma navegação que varia.
 */
export function ConfigTab({ versao, modelConfig, variaveis }: ConfigTabProps) {
  const temConfig =
    modelConfig !== null &&
    (modelConfig.model !== undefined ||
      modelConfig.temperature !== undefined ||
      modelConfig.maxTokens !== undefined);

  return (
    <div className="space-y-4">
      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Afinação {versao !== null ? `da v${String(versao)}` : ''}</h2>
          </Card.Title>
          <Card.Description>
            Modelo e parâmetros que ESTA revisão declara. A config é da revisão, não do prompt —
            criar a próxima não a herda por acidente.
          </Card.Description>
        </Card.Header>
        <div className="p-4 pt-0">
          {!temConfig ? (
            // Dito, nunca em branco: espaço vazio lê-se como "não carregou". A ausência é um fato
            // sobre a revisão — as anteriores ao M17 não têm config, e inventar uma retroativamente
            // apareceria numa auditoria como se alguém a tivesse escolhido.
            <p className="text-sm text-muted-foreground">
              Esta revisão não declara afinação. Quem a consome usa a do próprio cliente.
            </p>
          ) : (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
              {modelConfig.model !== undefined ? (
                <>
                  <dt className="text-muted-foreground">modelo</dt>
                  <dd className="font-mono text-xs">{modelConfig.model}</dd>
                </>
              ) : null}
              {modelConfig.temperature !== undefined ? (
                <>
                  <dt className="text-muted-foreground">temperature</dt>
                  <dd className="font-mono text-xs">{String(modelConfig.temperature)}</dd>
                </>
              ) : null}
              {modelConfig.maxTokens !== undefined ? (
                <>
                  <dt className="text-muted-foreground">maxTokens</dt>
                  <dd className="font-mono text-xs">{String(modelConfig.maxTokens)}</dd>
                </>
              ) : null}
            </dl>
          )}
        </div>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Variáveis exigidas</h2>
          </Card.Title>
          <Card.Description>
            O contrato de entrada: quem chamar este prompt precisa fornecer estes valores. A lista é
            DECLARADA pelo serviço a partir do texto — nunca deduzida por regex nosso.
          </Card.Description>
        </Card.Header>
        <div className="p-4 pt-0">
          {variaveis.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma variável — o prompt é servido exatamente como está escrito.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {variaveis.map((v) => (
                <li key={v} className="rounded-full border px-2 py-0.5 font-mono text-xs">
                  {v}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
