import { Card } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

/** A afinação declarada numa revisão (M17). */
export interface ModelConfigLido {
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface ConfigTabProps {
  /**
   * A leitura do prompt FALHOU?
   *
   * O `/review` mediu o defeito: com HTTP 500, esta aba dizia *"esta revisão não declara afinação"*
   * e *"nenhuma variável"* — duas afirmações sobre um dado que nunca chegou. Um operador que lê
   * "nenhuma variável" chama o prompt sem variáveis e recebe o template cru.
   */
  readonly ilegivel: boolean;
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
export function ConfigTab({ ilegivel, versao, modelConfig, variaveis }: ConfigTabProps) {
  if (ilegivel) {
    return (
      <Alert
        intent="destructive"
        title="Could not read this revision"
        description="The tuning and the required variables come from the same read, and it failed. Do not read this as 'this revision declares nothing' — they are different facts."
      />
    );
  }

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
            <h2>Tuning {versao !== null ? `of v${String(versao)}` : ''}</h2>
          </Card.Title>
          <Card.Description>
            Model and parameters THIS revision declares. The config belongs to the revision, not
            the prompt — creating the next one does not inherit it by accident.
          </Card.Description>
        </Card.Header>
        <div className="p-4 pt-0">
          {!temConfig ? (
            // Dito, nunca em branco: espaço vazio lê-se como "não carregou". A ausência é um fato
            // sobre a revisão — as anteriores ao M17 não têm config, e inventar uma retroativamente
            // apareceria numa auditoria como se alguém a tivesse escolhido.
            <p className="text-sm text-muted-foreground">
              This revision declares no tuning. Whoever consumes it uses their own client settings.
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
            <h2>Required variables</h2>
          </Card.Title>
          <Card.Description>
            The input contract: whoever calls this prompt must supply these values. The list is
            DECLARED by the service from the text — never inferred by a regex of ours.
          </Card.Description>
        </Card.Header>
        <div className="p-4 pt-0">
          {variaveis.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No variables — the prompt is served exactly as written.
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
