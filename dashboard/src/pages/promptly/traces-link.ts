import { type ColumnState, encodeColumns } from '../lens/traces/view-encoding';

/**
 * M23 — o caminho da aba de um prompt até as resoluções individuais dele.
 *
 * Nada aqui constrói um explorador: o do `theo-lens` já existe, já lê `span_query` da URL
 * (`pages/lens/traces.tsx`) e já tem um índice parcial sobre `attributes->>'prompt.id'` criado no
 * M15 exatamente para este acesso. Este módulo só monta o endereço.
 *
 * A construção mora num helper, e não inline no JSX, porque é o padrão que o peer maduro segue
 * (`getPromptTabs` do Langfuse — um lugar constrói as URLs entre superfícies, sempre codificando o
 * nome) e porque permite testá-la fora do React.
 */

const ROTA_DO_EXPLORADOR = '/observability/traces';

/** A chave do atributo que o `theo-promptly` carimba no span — leva o NOME do prompt, não um id. */
const ATRIBUTO_DO_PROMPT = 'prompt.id';

/**
 * O estado de colunas com que o link chega ao explorador.
 *
 * `tokens`, `cost` e `evals` são sempre vazios num `prompt.resolve` — resolver um prompt não chama
 * modelo nem avalia. Um destino que os exibe faz quem chegou concluir que a leitura falhou.
 * `latency` fica: a duração da resolução é informação real (medido: 1–17 ms).
 *
 * `model` NÃO pode ser escondida — não está em `TOGGLEABLE_COLUMNS`, e a tela só oculta colunas
 * desse conjunto. Ampliá-lo seria mudar a tela do `theo-lens`, que tem roadmap próprio. Passar de
 * quatro colunas vazias para uma é a melhora que cabe aqui.
 */
export const COLUNAS_DE_RESOLUCAO: ColumnState = {
  visibility: { latency: true, tokens: false, cost: false, evals: false },
  density: 'comfortable',
};

/**
 * Endereço do explorador do `theo-lens`, filtrado nas resoluções de UM prompt.
 *
 * Devolve `null` quando não há prompt — e essa é a correção de um defeito que a primeira versão
 * introduziu. Ela **lançava**, e o único chamador a invoca dentro do JSX: um `throw` durante o
 * render não é "falhe alto para quem sabe tratar", é o `ErrorBoundary` substituindo a tela de
 * detalhe inteira, com um botão *Retry* que re-renderiza o mesmo estado e estoura de novo.
 *
 * O nome ausente também não é excepcional: `detail.tsx` declara `const { promptName = '' }` e
 * guarda nove queries com `promptName !== ''` — é um estado **conhecido** do produto, e
 * `error-handling.md § 2` é explícito: *"Never use exceptions for control flow"*.
 *
 * `null` obriga o chamador a decidir o que mostrar, que é onde a decisão pertence.
 */
export function linkParaTracesDoPrompt(promptName: string): string | null {
  if (promptName.trim() === '') return null;
  const params = new URLSearchParams({
    // A DSL separa chave/valor no PRIMEIRO `=` (`theo-lens` span-query), então o nome pode conter
    // `=` sem ambiguidade. `URLSearchParams` cuida do escape de `&` e `#` na serialização — o que
    // impede um nome hostil de virar um segundo parâmetro ou de truncar a query.
    span_query: `attr:${ATRIBUTO_DO_PROMPT}=${promptName}`,
    cols: encodeColumns(COLUNAS_DE_RESOLUCAO),
  });
  return `${ROTA_DO_EXPLORADOR}?${params.toString()}`;
}
