import { BFF_NAVIGATION_REGEXP } from './sw-bff-paths';

/**
 * As regras de `runtimeCaching` do service worker.
 *
 * ## Por que num módulo, e não inline no `vite.config.ts`
 *
 * Pelo mesmo motivo que `sw-bff-paths.ts` saiu: uma lista dentro do config de
 * build não tem como ser testada, e esta é uma superfície onde o projeto já
 * teve três incidentes — `theo-cloud#112`, `#203` e a armadilha do `urlPattern`
 * como função, que derrubou TODO o roteamento do SW de uma vez.
 *
 * O config importa e passa adiante. O teste ao lado verifica o significado das
 * regras contra caminhos reais do app.
 *
 * ## A ORDEM DESTE ARRAY É SEMÂNTICA
 *
 * O Workbox registra as rotas nesta sequência e a PRIMEIRA cujo padrão casa atende
 * a requisição — as demais nem são consultadas. Uma regra mais genérica colocada
 * acima de uma específica torna a específica MORTA, sem erro nenhum. Foi o que
 * aconteceu com `/__config.js` (B-196). Ao acrescentar uma regra, a pergunta não é
 * "ela casa o que eu quero?" e sim "alguma acima dela já casa isso?".
 *
 * ## `urlPattern` é sempre um RegExp, nunca uma função
 *
 * O Workbox `generateSW` **serializa** o `urlPattern` para dentro de `sw.js` e
 * NÃO empacota os imports do módulo. Uma função que chame algo importado vira
 * um identificador livre e indefinido em tempo de execução do SW —
 * `ReferenceError` que mata o roteamento inteiro, uploads incluídos. Por isso
 * `BFF_NAVIGATION_REGEXP` é uma união pronta, e não `isBffNavigationPath`.
 */
export interface RegraDeCache {
  urlPattern: RegExp;
  handler: 'NetworkOnly' | 'NetworkFirst' | 'CacheFirst' | 'CacheOnly' | 'StaleWhileRevalidate';
  options?: {
    cacheName?: string;
    networkTimeoutSeconds?: number;
    expiration?: { maxEntries?: number; maxAgeSeconds?: number };
  };
}

export const SW_RUNTIME_CACHING: readonly RegraDeCache[] = [
  // Caminhos de navegação BFF — NetworkOnly: nunca entram em cache nenhum.
  // Espelha o `navigateFallbackDenylist` a partir da MESMA fonte, para que um
  // caminho novo não possa ser acrescentado a uma lista e esquecido na outra —
  // que é literalmente como #112 e #203 aconteceram.
  {
    urlPattern: BFF_NAVIGATION_REGEXP,
    handler: 'NetworkOnly',
  },
  // NÃO HÁ REGRA PARA `/api/v1/` AQUI, E ISSO É A DECISÃO — ver `ADR-0004`.
  //
  // Existiu uma: `NetworkFirst`, `networkTimeoutSeconds: 3`,
  // `maxAgeSeconds: 3600`. Contra o `staleTime: 60_000` do TanStack Query, era
  // sessenta vezes mais frouxa — e o problema não era o cache ficar velho, era
  // o Query receber dado de até uma hora e guardá-lo COMO FRESCO por mais 60 s.
  //
  // O TanStack Query é a única camada de cache de dado de servidor. Ele tem
  // invalidação por `queryKey`; o SW não tem nada equivalente, e é por isso que
  // as duas camadas não podiam coexistir sobre o mesmo dado.

  // Runtime config: NetworkFirst. The container writes /__config.js at start-up, so the network
  // copy is the only correct one; the cache is just the offline fallback. StaleWhileRevalidate
  // answered from cache first, so the first load after a config change still ran with the old
  // file. The build-time copy is kept out of the precache by sw-precache.ts, because a precache
  // route answers before every rule here (#547).
  //
  // B-196: THIS RULE COMES BEFORE THE ASSETS RULE, AND THAT ORDER IS WHAT MAKES IT RUN. Workbox
  // registers routes in this order and the FIRST match answers. `/__config.js` ends in `.js`, so
  // the assets rule, when it came first, served it CacheFirst for 30 days and this rule never ran.
  // The hashed-name premise that makes CacheFirst safe for assets does not hold for this file: it
  // has a fixed name and is generated when the container starts.
  {
    urlPattern: /\/__config\.js$/,
    handler: 'NetworkFirst',
    options: { cacheName: 'theo-config', networkTimeoutSeconds: 3 },
  },
  // Assets estáticos — CacheFirst, 30 dias. Cada build emite nomes com hash,
  // então uma entrada velha nunca é servida no lugar de uma nova.
  {
    urlPattern: /\.(js|css|woff2?|svg|png|webp)$/,
    handler: 'CacheFirst',
    options: {
      cacheName: 'theo-assets',
      expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
    },
  },
];
