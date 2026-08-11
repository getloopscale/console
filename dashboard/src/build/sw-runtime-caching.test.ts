import { describe, it, expect } from 'vitest';
import { SW_RUNTIME_CACHING } from './sw-runtime-caching';

/**
 * B-055 — o service worker NÃO guarda dado de servidor.
 *
 * ## A decisão que já existia e não tinha sido executada
 *
 * `ADR-0004` escolheu a opção 2 em 2026-08-06 — *"o cache de API sai; o TanStack
 * Query passa a ser a única camada de cache de dados de servidor"* — e o config
 * continuou com a regra por mais dois dias. Este teste é o que impede a terceira
 * vez: a decisão vira execução verificável, não parágrafo.
 *
 * ## O defeito que a regra produzia
 *
 * `NetworkFirst` em `/api/v1/` com `networkTimeoutSeconds: 3` e
 * `maxAgeSeconds: 3600`, contra o `staleTime: 60_000` do Query — sessenta vezes
 * mais frouxo.
 *
 * O caminho de falha não é "o cache fica velho". É pior: o Query decide que
 * expirou, refaz a busca, a rede demora mais de 3 s, o SW responde do cache com
 * dado de até **uma hora**, e o Query guarda essa resposta como **fresca** por
 * mais 60 s. A camada de baixo mentiu para a de cima, e a de cima não tem como
 * saber — `Cache-Control` não atravessa a fronteira do Workbox de volta.
 *
 * Num painel de operação isso significa ver um deploy como saudável depois de
 * ele ter caído. O `DESIGN.md:775` promete *"Confiável — status truthful"*, e o
 * próprio ADR conclui: **dado velho é pior que erro visível**.
 *
 * ## Por que este teste checa PATH e não o texto da regra
 *
 * Um teste que procurasse a string `/api/v1/` no config verificaria a FORMA. A
 * regra pode voltar com outra grafia — `/\/engine\//`, um host absoluto, um
 * `\/v\d+\/` — e passar limpo enquanto guarda exatamente o mesmo dado.
 *
 * Então ele checa o SIGNIFICADO: pega caminhos de API que o app realmente chama
 * (medidos em `src/lib/api/`) e exige que nenhum `urlPattern` com handler que
 * ARMAZENA case com eles. `NetworkOnly` é aceito por definição — ele não guarda
 * nada; é o que a regra dos caminhos BFF usa.
 *
 * O caminho com prefixo `/engine` está na lista de propósito: `engineFetch`
 * prefixa `/engine` (`lib/http/api.ts:303`), e a regex antiga casava por
 * substring — alcançava os reads do control plane sem nomeá-los.
 */

/** Handlers do Workbox que ESCREVEM em cache. `NetworkOnly` fica de fora: não escreve. */
const HANDLERS_QUE_GUARDAM = [
  'CacheFirst',
  'CacheOnly',
  'NetworkFirst',
  'StaleWhileRevalidate',
] as const;

/**
 * Caminhos de dado de servidor que o app realmente busca — medidos em
 * `src/lib/api/`, não inventados. Incluem a forma com prefixo `/engine` porque é
 * por ela que a regra antiga alcançava o control plane.
 */
const CAMINHOS_DE_DADO = [
  '/api/v1/projects',
  '/api/v1/builds',
  '/api/v1/deploys',
  '/api/v1/domains',
  '/api/v1/environments',
  '/api/v1/audit',
  '/engine/api/v1/projects',
  '/engine/api/v1/builds',
] as const;

describe('cache do service worker (B-055)', () => {
  it('nenhuma regra que ARMAZENA alcança um caminho de dado de servidor', () => {
    const violacoes: string[] = [];

    for (const regra of SW_RUNTIME_CACHING) {
      if (!HANDLERS_QUE_GUARDAM.includes(regra.handler as never)) continue;
      for (const caminho of CAMINHOS_DE_DADO) {
        if (regra.urlPattern.test(caminho)) {
          violacoes.push(
            `${regra.handler} (${regra.options?.cacheName ?? 'sem nome'}) alcança ${caminho}`,
          );
        }
      }
    }

    expect(
      violacoes,
      'O service worker voltou a guardar dado de servidor.\n\n' +
        'São duas camadas de cache com TTLs diferentes e nenhuma coordenação. O\n' +
        'Query decide que expirou e refaz a busca; se a rede demorar, o SW responde\n' +
        'do cache dele e o Query guarda a resposta velha COMO FRESCA. A camada de\n' +
        'baixo mente para a de cima, e a de cima não tem como saber.\n\n' +
        'Num painel de operação, dado velho é pior que erro visível — é agir sobre\n' +
        'uma realidade que já mudou. A decisão está no `ADR-0004`.\n\n' +
        'Se a intenção é leitura offline, ela precisa de um ADR próprio: hoje não\n' +
        'existe requisito de offline em nenhum documento do projeto, e um painel\n' +
        'de operação offline não consegue fazer nada além de ler estado errado.\n',
    ).toEqual([]);
  });

  it('as regras que DEVEM ficar continuam alcançando o que lhes cabe', () => {
    // Sem este caso, o de cima passa com o array VAZIO — que é o modo de falha
    // que este repositório já pagou hoje mais de uma vez: um teste que afirma
    // ausência precisa provar que olhou para algum lugar.
    const alcanca = (alvo: string) =>
      SW_RUNTIME_CACHING.some(
        (r) => HANDLERS_QUE_GUARDAM.includes(r.handler as never) && r.urlPattern.test(alvo),
      );

    expect(alcanca('/assets/index-a1b2c3.js'), 'asset estático deixou de ser cacheado').toBe(true);
    expect(alcanca('/assets/logo.woff2'), 'fonte deixou de ser cacheada').toBe(true);
    expect(alcanca('/__config.js'), 'config de runtime deixou de ser cacheado').toBe(true);
  });

  it('os caminhos de navegação BFF continuam NetworkOnly', () => {
    // theo-cloud#112 e #203 — a classe de bug que reincidiu duas vezes. Cachear
    // um destes devolve a tela de "Page not found" no lugar do redirect do BFF.
    const bff = SW_RUNTIME_CACHING.filter((r) => r.handler === 'NetworkOnly');
    expect(bff.length, 'a regra NetworkOnly dos caminhos BFF sumiu').toBeGreaterThan(0);
    expect(bff.some((r) => r.urlPattern.test('/api/v1/auth/whoami'))).toBe(true);
  });
});
