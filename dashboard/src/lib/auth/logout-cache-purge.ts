/**
 * Apaga, no logout, os caches do service worker que guardam dado de tenant.
 *
 * ## O defeito que isto fecha (B-055 / B-074)
 *
 * `vite.config.ts` registra um service worker que guarda respostas de
 * `/api/v1/*` com `NetworkFirst` — 100 entradas, 1 hora, fallback para o cache
 * quando a rede falha ou passa de 3 segundos.
 *
 * O Workbox chaveia pela **URL**, e `/api/v1/projects` é a mesma URL para todo
 * mundo: o tenant vem do `Authorization`, que não entra na chave.
 *
 * `logout()` limpava o JWT, avisava as outras abas e destruía a sessão no
 * Kratos, mas não tocava no cache — `caches.delete` não existia em nenhum lugar
 * de `src/`. Então a resposta de quem saiu ficava no disco, e uma falha de rede
 * dentro da hora seguinte a servia para quem entrasse depois.
 *
 * Não exige estar offline. Os 3 segundos de timeout tornam isso rotina numa
 * conexão ruim.
 *
 * ## O que esta função NÃO decide
 *
 * Se o service worker deve cachear a API. Essa é a pergunta do `B-074` e é
 * decisão de produto: um dashboard operacional servindo dado de uma hora atrás
 * quando a rede cai pode ser o certo (melhor que nada) ou o errado (mostrar um
 * deploy como "rodando" quando ele falhou). Enquanto a decisão não é tomada, o
 * buraco existe — e ele existe independentemente dela.
 *
 * ## Por que só os caches de dado
 *
 * JS, CSS e fontes são idênticos para todo mundo e caros de rebaixar. Apagar
 * tudo transformaria cada logout numa recarga fria: custo real, zero de
 * segurança, e é o tipo de excesso que faz alguém desligar a limpeza inteira.
 */

/**
 * Prefixos dos caches que guardam dado de tenant.
 *
 * Prefixo, e não nome exato, porque o Workbox versiona (`loop-runtime-api-v3`). Casar
 * por igualdade deixaria um cache renomeado sobreviver ao logout, em silêncio.
 *
 * ## `loop-runtime-api` continua aqui DEPOIS de a regra ter saído do build
 *
 * Desde o `ADR-0004`/B-055 o service worker não guarda mais dado de servidor, e
 * um build novo nunca cria `loop-runtime-api`. Manter a entrada não é resíduo: **o
 * service worker que está instalado no navegador de alguém ainda tem o cache
 * dele.** Ele só é substituído quando aquela pessoa carrega a página de novo, e
 * até lá o dado do tenant anterior continua em disco.
 *
 * Ou seja, o único momento em que esta linha importa é exatamente o que ela
 * cobre: alguém com a versão velha instalada faz logout. Apagá-la porque "o
 * build não cria mais" seria raciocinar sobre o código, não sobre os
 * navegadores que existem.
 *
 * Espelha `src/build/sw-runtime-caching.ts`. Um `cacheName` novo de dado
 * precisa entrar aqui — `logout-cache-purge.test.ts` é a única coisa que
 * lembra disso.
 */
export const CACHES_DE_DADOS = ['loop-runtime-api'] as const;

function guardaDado(name: string): boolean {
  return CACHES_DE_DADOS.some((p) => name === p || name.startsWith(`${p}-`));
}

/** O que a purga conseguiu fazer. `sobreviventes` é a lista de caches que NÃO foram apagados. */
export interface ResultadoDaPurga {
  readonly tentados: number;
  readonly sobreviventes: readonly string[];
  /** `caches` não existe neste ambiente — não houve o que tentar, e isso não é falha. */
  readonly indisponivel: boolean;
}

/**
 * Nunca lança e nunca rejeita — mas agora RELATA (B-170).
 *
 * `caches` não existe em contexto inseguro, em alguns navegadores e no jsdom. E uma exceção aqui
 * impediria a pessoa de SAIR, trocando o defeito por um pior. Uma limpeza parcial já é melhor que
 * nenhuma, e isso continua valendo.
 *
 * O que mudou: o `.catch(() => false)` de cada `delete` tinha o retorno DESCARTADO pelo
 * `Promise.all`, e o `catch` externo era vazio. Um cache de dados de tenant que sobrevivesse ao
 * logout produzia zero sinal — nenhum log, nenhum contador, e um `Promise<void>` que não deixava
 * ao chamador nada para inspecionar. Numa aplicação multi-tenant, dado de um tenant sobrevivendo à
 * troca de sessão é a falha que mais cara custa, e era a única que a função garantia não contar.
 *
 * Continua sem lançar: o retorno é um relato, não um erro. Quem chama decide o que fazer com ele —
 * e agora tem como.
 */
export async function purgarCachesDeDados(): Promise<ResultadoDaPurga> {
  if (typeof caches === 'undefined') return { tentados: 0, sobreviventes: [], indisponivel: true };
  try {
    const names = (await caches.keys()).filter(guardaDado);
    const resultados = await Promise.all(
      names.map(async (n) => ({ nome: n, apagado: await caches.delete(n).catch(() => false) })),
    );
    return {
      tentados: names.length,
      sobreviventes: resultados.filter((r) => !r.apagado).map((r) => r.nome),
      indisponivel: false,
    };
  } catch {
    // Storage bloqueado ou API indisponível. O logout segue — mas quem chama fica sabendo que a
    // purga não aconteceu, em vez de receber o mesmo silêncio de um sucesso.
    return { tentados: 0, sobreviventes: [], indisponivel: true };
  }
}
