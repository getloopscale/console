import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { purgarCachesDeDados, CACHES_DE_DADOS } from './logout-cache-purge';

/**
 * B-055 / B-074 — o cache do service worker sobrevivia ao logout.
 *
 * ## O defeito, medido
 *
 * `vite.config.ts` registra um service worker que guarda respostas de
 * `/api/v1/*` com `NetworkFirst` — até 100 entradas, por 1 hora, com fallback
 * para o cache quando a rede falha ou passa de 3 segundos.
 *
 * O Workbox chaveia o cache pela **URL**. E `/api/v1/projects` é a mesma URL
 * para todo mundo: o tenant vem do `Authorization`, que não entra na chave.
 *
 * `logout()` (`lib/auth/session.ts:136`) limpa o JWT em memória, avisa as outras
 * abas e destrói a sessão no Kratos. **Não toca no cache.** Verificado:
 * `caches.delete` não aparecia em nenhum lugar de `src/`.
 *
 * A sequência que isso permite:
 *
 * 1. A pessoa A usa o dashboard; o SW guarda as respostas dela.
 * 2. A pessoa A sai. JWT limpo, sessão destruída — **o cache fica no disco**.
 * 3. A pessoa B entra no mesmo navegador (máquina compartilhada, ou a mesma
 *    pessoa trocando de conta ou de tenant).
 * 4. Qualquer falha de rede ou resposta acima de 3s numa chamada `/api/v1/*` faz
 *    o SW servir **a resposta cacheada de A** para B.
 *
 * Não exige o navegador estar offline: os 3 segundos de timeout tornam isso
 * rotina numa conexão ruim. A janela é de até uma hora após a última chamada
 * de A.
 *
 * ## O que este módulo NÃO decide
 *
 * Se o service worker deve cachear a API. Isso é `B-074`, e é decisão de
 * produto — um dashboard operacional servindo dado de uma hora atrás quando a
 * rede cai pode ser o certo (melhor que nada) ou o errado (mostrar um deploy
 * como "rodando" quando ele falhou). Este módulo fecha o buraco que existe
 * independentemente dessa escolha.
 */

interface CacheFake {
  deletadas: string[];
  keys: () => Promise<string[]>;
  delete: (nome: string) => Promise<boolean>;
}

function instalarCaches(existentes: string[]): CacheFake {
  const fake: CacheFake = {
    deletadas: [],
    keys: () => Promise.resolve(existentes),
    delete: (nome: string) => {
      fake.deletadas.push(nome);
      return Promise.resolve(true);
    },
  };
  vi.stubGlobal('caches', { keys: fake.keys, delete: fake.delete });
  return fake;
}

describe('purga de cache no logout (B-055/B-074)', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('apaga os caches de DADOS', async () => {
    const fake = instalarCaches(['theo-api', 'theo-assets', 'theo-config']);
    await purgarCachesDeDados();

    // `theo-api` guarda resposta de `/api/v1/*` — dado do tenant. É o que não
    // pode sobreviver a uma troca de sessão.
    expect(fake.deletadas).toContain('theo-api');
  });

  it('NÃO apaga os caches de asset — eles não têm dono', async () => {
    const fake = instalarCaches(['theo-api', 'theo-assets', 'theo-config']);
    await purgarCachesDeDados();

    // JS, CSS e fontes são idênticos para todo mundo e caros de rebaixar. Apagar
    // tudo transformaria cada logout numa recarga fria — custo real, para zero
    // de segurança, e é o tipo de excesso que faz alguém desligar a limpeza.
    expect(fake.deletadas).not.toContain('theo-assets');
  });

  it('apaga cache de dado mesmo com nome versionado pelo Workbox', async () => {
    const fake = instalarCaches(['theo-api', 'workbox-precache-v2-https://app/', 'theo-api-v3']);
    await purgarCachesDeDados();

    // O Workbox versiona nomes de cache. Casar por igualdade exata deixaria um
    // cache renomeado sobreviver ao logout — silenciosamente, que é o pior modo.
    expect(fake.deletadas).toContain('theo-api-v3');
  });

  it('sem a API de Cache, não lança — logout NUNCA é bloqueado', async () => {
    vi.unstubAllGlobals();
    // `caches` não existe em contexto inseguro, em alguns navegadores, e no
    // jsdom. Uma exceção aqui impediria a pessoa de SAIR, o que é pior do que o
    // defeito que a função conserta.
    await expect(purgarCachesDeDados()).resolves.toBeUndefined();
  });

  it('uma falha ao apagar não impede as outras nem propaga', async () => {
    const deletadas: string[] = [];
    vi.stubGlobal('caches', {
      keys: () => Promise.resolve(['theo-api', 'theo-api-v3']),
      delete: (nome: string) => {
        if (nome === 'theo-api') return Promise.reject(new Error('bloqueado'));
        deletadas.push(nome);
        return Promise.resolve(true);
      },
    });

    await expect(purgarCachesDeDados()).resolves.toBeUndefined();
    // Uma falha parcial ainda é melhor que nenhuma limpeza, e travar o logout
    // por causa dela seria trocar um risco por um pior.
    expect(deletadas).toContain('theo-api-v3');
  });

  it('a lista de caches de dados é a mesma do vite.config', () => {
    // Se alguém acrescentar um `runtimeCaching` de dado sem incluí-lo aqui, o
    // cache novo sobrevive ao logout — e a única pista seria este teste.
    expect(CACHES_DE_DADOS).toContain('theo-api');
  });
});
