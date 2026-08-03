import { afterEach, describe, expect, it, vi } from 'vitest';

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) };
});

import { fetchCatalogPage } from './promptly-api';

/**
 * M13 pós-review (TA-02) — a cola que lê o header não tinha teste em nível ALGUM.
 *
 * `fetchCatalogPage` é a única peça que chama `resp.headers.get('Link')`. O teste de página faz
 * `vi.mock` dela inteira, e o mock do e2e só emite o header quando o catálogo excede o limite — o
 * que nunca acontece com 3 prompts e `limit=100`. Resultado: `temProximaPagina` estava provado
 * sobre strings escritas pelo teste, e a leitura do header, sobre nada.
 *
 * Estes casos exercitam um `Response` de verdade, com e sem o header. Se `cloudFetch` deixar de
 * expor a resposta, ou o nome do header mudar, eles ficam vermelhos — que era exatamente o que não
 * acontecia antes.
 */

/** Reproduz o contrato de `cloudFetch`: parseia o corpo e chama `onResponse` com a resposta. */
function cloudFetchQueResponde(resp: Response) {
  return async (_path: string, _opts: unknown, cfg?: { onResponse?: (r: Response) => void }) => {
    cfg?.onResponse?.(resp);
    return (await resp.clone().json()) as unknown;
  };
}

afterEach(() => {
  mockCloudFetch.mockReset();
});

describe('fetchCatalogPage', () => {
  it('reporta continuação quando a resposta traz Link rel=next', async () => {
    mockCloudFetch.mockImplementation(
      cloudFetchQueResponde(
        new Response(JSON.stringify([{ name: 'a' }]), {
          headers: { Link: '</v1/dashboard/promptly/prompts?after=a&limit=1>; rel="next"' },
        }),
      ),
    );

    const page = await fetchCatalogPage<unknown[]>(1);

    expect(page.temContinuacao).toBe(true);
    expect(page.data).toEqual([{ name: 'a' }]);
  });

  // O PAR QUE DISCRIMINA: mesmo corpo, header ausente, decisão oposta. Sem ele, uma implementação
  // que devolvesse `true` sempre passaria no caso acima.
  it('NÃO reporta continuação quando a resposta não traz o header', async () => {
    mockCloudFetch.mockImplementation(
      cloudFetchQueResponde(new Response(JSON.stringify([{ name: 'a' }]))),
    );

    const page = await fetchCatalogPage<unknown[]>(1);

    expect(page.temContinuacao).toBe(false);
    expect(page.data).toEqual([{ name: 'a' }]);
  });

  it('não confunde outro rel com continuação', async () => {
    mockCloudFetch.mockImplementation(
      cloudFetchQueResponde(
        new Response(JSON.stringify([]), {
          headers: { Link: '</v1/dashboard/promptly/prompts?after=a>; rel="prev"' },
        }),
      ),
    );

    expect((await fetchCatalogPage<unknown[]>(1)).temContinuacao).toBe(false);
  });

  /**
   * A razão de existir do `onResponse`: `cloudFetchRaw` daria acesso ao header mas NÃO reproduz o
   * refresh-e-retry no 401 nem o interceptor de 402 — a porta de entrada da capacidade quebraria
   * numa expiração de sessão onde a tela vizinha se recupera sozinha, sobre o mesmo recurso.
   * Este teste trava a passagem pelo pipeline compartilhado.
   */
  it('atravessa o pipeline compartilhado, com throwOnError', async () => {
    mockCloudFetch.mockImplementation(cloudFetchQueResponde(new Response(JSON.stringify([]))));

    await fetchCatalogPage<unknown[]>(50);

    const [caminho, , cfg] = mockCloudFetch.mock.calls[0] as [string, unknown, { throwOnError?: boolean }];
    expect(caminho).toContain('limit=50');
    expect(cfg.throwOnError).toBe(true);
  });

  it('propaga a recusa tipada em vez de resolver para lista vazia', async () => {
    const { ApiError } = await import('@/lib/api');
    mockCloudFetch.mockRejectedValue(new ApiError(502, undefined, 'upstream'));

    // "não há prompts" e "não consegui perguntar" levam a decisões opostas — o erro precisa subir.
    await expect(fetchCatalogPage<unknown[]>(1)).rejects.toBeInstanceOf(ApiError);
  });
});
