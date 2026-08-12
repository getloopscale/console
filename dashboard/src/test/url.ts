/**
 * Comparação de URL em mocks de fetch.
 *
 * ## O defeito que isto corrige
 *
 * Os mocks casavam a URL inteira por igualdade: `if (url === '/v1/x') …`. Isso
 * torna o teste sensível à QUERY, e a query não é o que o teste está afirmando.
 * Quando B-024 acrescentou `?limit=N` a vinte leituras — uma correção legítima,
 * que não muda comportamento nenhum que os testes verificavam — 66 testes em 9
 * arquivos ficaram vermelhos de uma vez.
 *
 * Um teste que quebra assim está testando a FORMA da chamada, não o que a tela
 * faz. E o custo real não é o vermelho: é que a próxima pessoa aprende que mexer
 * na query dá trabalho, e passa a não mexer.
 *
 * ## O contrato
 *
 * `isPath(url, '/v1/x')` é verdadeiro para `/v1/x` e `/v1/x?limit=200`, e falso
 * para `/v1/x/abc`. A distinção do sufixo importa: `startsWith`, que já aparecia
 * em alguns arquivos como remendo, casaria `/monitors/gd_1` com `/monitors` e
 * faria o mock devolver a lista onde a tela pediu um item.
 *
 * Quando o teste PRECISA afirmar a query — e alguns precisam, como o que prova
 * que a janela consultada é a mesma janela da regra — ele lê `url` direto. Este
 * helper é para o caso comum, em que a query é irrelevante para a asserção.
 */
export function isPath(url: unknown, path: string): boolean {
  const s = String(url);
  const q = s.indexOf('?');
  return (q === -1 ? s : s.slice(0, q)) === path;
}
