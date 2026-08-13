/**
 * A frase que a gaveta de entregas mostra quando a LEITURA falhou (B-167).
 *
 * Fora do componente por duas razões. A primeira é a mesma dos descritores de estado vazio: texto
 * de produto é dado, e um parágrafo de cinco linhas no meio de um ternário é o pior lugar para
 * revisá-lo. A segunda é o orçamento de LoC — a página passou do teto ao ganhar esta perna, e a
 * catraca (B-009/B-033) manda decompor em vez de subir o número.
 *
 * A frase diz o que a tela NÃO está mostrando, e não apenas que algo deu errado: "está mostrando
 * nada, e não o que existe" é a diferença entre um webhook sem entregas e um webhook que falhou
 * cem vezes — que pedem ações opostas de quem está lendo.
 */
export const DELIVERIES_READ_FAILURE =
  "Could not read this webhook's deliveries. The request failed, so this is showing nothing " +
  'rather than what exists. Retry, and if it keeps failing the service is likely unavailable.';
