/**
 * M143 — a agregação que a faixa de KPIs do consumo por end-user consome.
 *
 * Função PURA, fora do componente, por uma razão medida no M142: o que quebrou lá não foi a
 * renderização, foi a aritmética sem oráculo (a coluna Tokens podia contar só a entrada e nenhum
 * teste morria). Aritmética testável isolada é aritmética que a mutação alcança.
 *
 * TRÊS DECISÕES QUE NÃO SÃO ESTILO — cada uma tem um teste que fica vermelho se sumir:
 *
 *  1. `completo` distingue somar TODOS os usuários de somar a PÁGINA. A resposta do serviço não
 *     traz totais agregados (`{users, unpricedSpans, totalUsers, windowDays}`), então com 400
 *     usuários e página de 50 o cabeçalho cobre 50 — e chamar isso de "total" é a mesma classe de
 *     mentira que `unpricedSpans` existe para impedir.
 *  2. `cacheRatio` é `null`, nunca `0`, quando não há leitura de cache. "Não usou cache" e "não
 *     sabemos" são fatos diferentes, e um `0%` afirma o primeiro sobre o segundo.
 *  3. `participacoes` é `null` quando o custo somado é zero. Não é `0%` nem `NaN%`: sem denominador
 *     nenhuma fatia é afirmável.
 */

export interface ConsumptionRow {
  userId: string;
  spans: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export interface ConsumptionSummary {
  /** Soma de `costUsd` das linhas EXIBIDAS — leia junto de `completo`. */
  costUsd: number;
  /** Entrada + saída das linhas exibidas. Cache é outra grandeza e não entra aqui. */
  tokens: number;
  /** Fração da entrada servida por cache, ou `null` quando não houve leitura de cache alguma. */
  cacheRatio: number | null;
  /** Fatia do custo por linha, na mesma ordem recebida; `null` quando o custo somado é zero. */
  participacoes: (number | null)[];
  /** true quando as linhas exibidas cobrem todos os usuários do período. */
  completo: boolean;
}

export function summarizeConsumption(rows: ConsumptionRow[], totalUsers: number): ConsumptionSummary {
  let costUsd = 0;
  let tokens = 0;
  let entradaFresca = 0;
  let leituraDeCache = 0;

  for (const l of rows) {
    costUsd += l.costUsd;
    tokens += l.inputTokens + l.outputTokens;
    entradaFresca += l.inputTokens;
    leituraDeCache += l.cacheReadTokens;
  }

  // O denominador são as DUAS pontas: sem a entrada fresca a razão daria sempre 100%, que é a
  // leitura que faz o indicador parecer bom independentemente do que aconteceu.
  const entradaTotal = entradaFresca + leituraDeCache;
  const cacheRatio = leituraDeCache > 0 && entradaTotal > 0 ? leituraDeCache / entradaTotal : null;

  const participacoes = rows.map((l) => (costUsd > 0 ? l.costUsd / costUsd : null));

  return { costUsd, tokens, cacheRatio, participacoes, completo: rows.length >= totalUsers };
}
