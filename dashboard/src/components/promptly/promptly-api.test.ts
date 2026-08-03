import { afterEach, describe, expect, it, vi } from 'vitest';

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) };
});

import { fetchCatalogPage, runPlayground } from './promptly-api';

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

/**
 * M14 pós-review (H1) — `runPlayground` era o único elo do caminho PAGO sem
 * oráculo em CI, e o defeito é o mesmo que o pós-review do M13 já corrigira uma
 * vez neste arquivo.
 *
 * Todo teste de tela dubla o módulo inteiro (`vi.mock`), e o e2e deliberadamente
 * não clica em Rodar — então método, caminho e as chaves do corpo não eram
 * asseridos em lugar nenhum. Renomear `credential` para `credentials`, ou errar o
 * caminho, deixaria 2328 testes verdes e só quebraria na aceitação, com chave
 * real.
 */
describe('runPlayground — o contrato de fio da invocação', () => {
  afterEach(() => {
    mockCloudFetch.mockReset();
  });

  it('POSTa no caminho do BFF daquele prompt', async () => {
    mockCloudFetch.mockResolvedValue({ text: 'ok' });

    await runPlayground('saudacao', '{{t}}', { t: 'x' }, 'sk-x');

    const [path, opts] = mockCloudFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/v1/dashboard/promptly/prompts/saudacao/playground');
    expect(opts.method).toBe('POST');
  });

  it('o corpo carrega credential, content e variables — os tres nomes que o servico le', async () => {
    mockCloudFetch.mockResolvedValue({ text: 'ok' });

    await runPlayground('saudacao', 'Escreva sobre {{topico}}', { topico: 'chuva' }, 'sk-SEGREDO');

    const [, opts] = mockCloudFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(opts.body))).toEqual({
      credential: 'sk-SEGREDO',
      content: 'Escreva sobre {{topico}}',
      variables: { topico: 'chuva' },
    });
  });

  /**
   * `throwOnError` não é detalhe: sem ele `cloudFetch` devolve `null` em vez de
   * lançar, o `ApiError` nunca chega a `classificarFalha`, e a recusa do provider
   * vira uma tela em branco — o DoD-5 inteiro depende desta linha.
   */
  it('pede throwOnError, senao a recusa tipada nunca chega a classificarFalha', async () => {
    mockCloudFetch.mockResolvedValue({ text: 'ok' });

    await runPlayground('saudacao', '{{t}}', { t: 'x' }, 'sk-x');

    const [, , cfg] = mockCloudFetch.mock.calls[0] as [string, RequestInit, { throwOnError?: boolean }];
    expect(cfg.throwOnError).toBe(true);
  });

  /** A credencial NÃO pode escapar para a query string — histórico e log de acesso a guardariam. */
  it('a credencial vai no corpo e em lugar nenhum do caminho', async () => {
    mockCloudFetch.mockResolvedValue({ text: 'ok' });

    await runPlayground('saudacao', '{{t}}', { t: 'x' }, 'sk-SEGREDO');

    const [path] = mockCloudFetch.mock.calls[0] as [string];
    expect(path).not.toContain('sk-SEGREDO');
  });

  it('escapa o nome do prompt no caminho', async () => {
    mockCloudFetch.mockResolvedValue({ text: 'ok' });

    await runPlayground('a b/c', '{{t}}', { t: 'x' }, 'sk-x');

    const [path] = mockCloudFetch.mock.calls[0] as [string];
    expect(path).toBe('/v1/dashboard/promptly/prompts/a%20b%2Fc/playground');
  });
});
