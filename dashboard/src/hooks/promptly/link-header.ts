/**
 * Leitura do header `Link` de paginação (RFC 8288).
 *
 * B-052 — morava em `pages/promptly/components/projections.ts`, um módulo de 357
 * linhas sobre projeção de tela. O guard de camada apanhou quando o transporte
 * precisou dela: `hooks/` não importa de `pages/`.
 *
 * E o lugar aqui é o certo por assunto, não só por camada — decidir se há
 * próxima página é ler uma resposta HTTP, que é o trabalho de quem faz o
 * request. Um módulo de apresentação que sabe parsear header carrega uma
 * responsabilidade que não é dele.
 */

/**
 * Lê do header `Link` se há próxima página.
 *
 * Header ausente é **ausência de continuação**, nunca erro: se um proxy o removesse, o painel
 * mostraria os números sem a marca de parcialidade — subnotificando. A direção oposta (marcar
 * parcial sem saber) seria pior, porque ensina a desconfiar de um número correto.
 */
/**
 * O marcador de continuação da RFC 5988, nas três grafias que ela permite.
 *
 * Espelha `linkNextRE` do BFF (Go) pela mesma razão que ele existe: nós emitimos com aspas duplas,
 * mas um proxy que normalize o header o deixaria sem — e ler só a nossa grafia devolveria "sem
 * continuação" sobre um catálogo truncado, ou seja, um TOTAL FALSO no painel. O `\b` impede que
 * `rel=nextpage` case.
 */
const REL_NEXT = /<[^>]*>\s*;[^,]*\brel\s*=\s*("next"|'next'|next\b)/i;

export function temProximaPagina(linkHeader: string | null | undefined): boolean {
  return Boolean(linkHeader) && REL_NEXT.test(linkHeader as string);
}
