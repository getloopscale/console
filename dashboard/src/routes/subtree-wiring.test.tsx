// @vitest-environment node
//
// No JSX, no render, no DOM global. The classifier short-circuited on the `.tsx` extension
// until the /review of 2026-08-13 refuted that axiom; widened, it found this file paying for
// a browser it never opens (B-280).

import { describe, it, expect } from 'vitest';
import { createRoutesFromChildren } from 'react-router-dom';
import { sandboxRoutes } from './sandboxes-routes';
import { rotasDeTrust } from './trust-routes';

/**
 * B-003 — um subtree de rotas extraído continua sendo ROTAS.
 *
 * ## O modo de falha que este teste existe para pegar
 *
 * `<Routes>` não aceita um componente que devolva rotas. O
 * `createRoutesFromChildren` do react-router percorre os filhos procurando
 * `<Route>` e `React.Fragment`; **qualquer outro tipo de elemento ele ignora
 * em silêncio.**
 *
 * Então `<TrustRoutes />` compilaria, passaria no lint, renderizaria sem erro —
 * e as cinco rotas de confiança simplesmente não existiriam. Quem navegasse
 * para `/trust` cairia no `path="*"`, que é a tela de 404. Um recurso inteiro
 * sumindo com a suíte verde.
 *
 * Por isso cada subtree é um VALOR JSX (um fragmento), e por isso este teste
 * pergunta ao PRÓPRIO react-router quantas rotas ele enxerga — em vez de
 * confiar que o fragmento funciona porque a documentação diz que sim.
 */

describe('subtrees de rotas extraídos (B-003)', () => {
  it('o react-router enxerga as rotas dentro do fragmento', () => {
    const rotas = createRoutesFromChildren(rotasDeTrust);
    const caminhos = rotas.map((r) => r.path).sort();

    expect(
      caminhos,
      'O react-router não enxergou as rotas do subtree.\n\n' +
        'Se a contagem veio ZERO, o subtree provavelmente virou um COMPONENTE em\n' +
        'vez de um fragmento — e nesse caso o router ignora tudo em silêncio: a\n' +
        'navegação cai no `path="*"` e o domínio inteiro vira 404 com a suíte\n' +
        'verde.\n',
    ).toEqual([
      '/trust',
      '/trust/enforcement',
      '/trust/guardrails',
      '/trust/guardrails/new',
      '/trust/violations',
    ]);
  });

  it('cada rota do subtree carrega um elemento', () => {
    // Uma rota sem `element` casa o caminho e não renderiza nada — a tela fica
    // em branco, que é pior que o 404: o 404 ao menos diz o que aconteceu.
    const semElemento = createRoutesFromChildren(rotasDeTrust)
      .filter((r) => !r.element)
      .map((r) => r.path);
    expect(semElemento).toEqual([]);
  });

  it('react-router sees the four routes of the Sandboxes area, each with an element', () => {
    const routes = createRoutesFromChildren(sandboxRoutes);

    expect(routes.map((r) => r.path).sort()).toEqual([
      '/sandboxes',
      '/sandboxes/:id',
      '/sandboxes/secrets',
      '/sandboxes/templates',
    ]);
    expect(routes.filter((r) => !r.element).map((r) => r.path)).toEqual([]);
  });
});
