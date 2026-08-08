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
 * Prefixo, e não nome exato, porque o Workbox versiona (`theo-api-v3`). Casar
 * por igualdade deixaria um cache renomeado sobreviver ao logout, em silêncio.
 *
 * Espelha o `runtimeCaching` de `vite.config.ts`. Um `cacheName` novo de dado
 * precisa entrar aqui — `logout-cache-purge.test.ts` é a única coisa que
 * lembra disso.
 */
export const CACHES_DE_DADOS = ['theo-api'] as const;

function guardaDado(nome: string): boolean {
  return CACHES_DE_DADOS.some((p) => nome === p || nome.startsWith(`${p}-`));
}

/**
 * Nunca lança e nunca rejeita.
 *
 * `caches` não existe em contexto inseguro, em alguns navegadores e no jsdom. E
 * uma exceção aqui impediria a pessoa de SAIR — trocar o defeito por um pior.
 * Uma limpeza parcial já é melhor que nenhuma.
 */
export async function purgarCachesDeDados(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const nomes = await caches.keys();
    await Promise.all(
      nomes.filter(guardaDado).map((n) => caches.delete(n).catch(() => false)),
    );
  } catch {
    // Storage bloqueado ou API indisponível. O logout segue.
  }
}
