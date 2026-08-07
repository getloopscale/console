import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./http/config', () => ({ API_URL: 'http://test.local', mocksEnabled: () => false }));

/**
 * B-042 — o canal de coordenacao entre abas tem ciclo de vida explicito.
 *
 * Antes, `new BroadcastChannel('theo-auth')` rodava no topo de `lib/api.ts`, como
 * efeito colateral de import. Esse modulo tem 151 importadores, entao qualquer um
 * deles — inclusive um teste que so queria uma funcao pura — abria um canal real
 * e registrava um handler que REDIRECIONA a pagina ao receber 'logged-out'.
 *
 * Dois custos concretos, e o segundo e o que este teste guarda:
 *  - nao havia teardown: nada podia fechar o canal, e o isolamento entre testes
 *    dependia de `vi.resetModules`;
 *  - o efeito era invisivel no ponto de uso — ninguem que le `import { cloudFetch }`
 *    espera que a linha abra um canal e arme um redirect.
 */
describe('installAuthChannel — ciclo de vida explicito (B-042)', () => {
  let aberturas: string[];
  let fechados: number;
  const RealBC = globalThis.BroadcastChannel;

  beforeEach(() => {
    aberturas = [];
    fechados = 0;
    vi.resetModules();
    class FakeBC {
      onmessage: ((e: MessageEvent) => void) | null = null;
      constructor(public name: string) {
        aberturas.push(name);
      }
      postMessage() {}
      close() {
        fechados += 1;
      }
    }
    globalThis.BroadcastChannel = FakeBC as unknown as typeof BroadcastChannel;
  });

  afterEach(() => {
    globalThis.BroadcastChannel = RealBC;
  });

  it('importar lib/api NAO abre canal nenhum', async () => {
    await import('./api');
    // Este era o comportamento antigo: o import bastava para abrir.
    expect(aberturas).toEqual([]);
  });

  it('installAuthChannel abre o canal theo-auth', async () => {
    const { installAuthChannel } = await import('./api');
    installAuthChannel();
    expect(aberturas).toEqual(['theo-auth']);
  });

  it('e idempotente — chamar duas vezes nao abre dois canais', async () => {
    const { installAuthChannel } = await import('./api');
    installAuthChannel();
    installAuthChannel();
    expect(aberturas).toEqual(['theo-auth']);
  });

  it('devolve um dispose que fecha o canal — o teardown que nao existia', async () => {
    const { installAuthChannel } = await import('./api');
    const dispose = installAuthChannel();
    expect(fechados).toBe(0);
    dispose();
    expect(fechados).toBe(1);
  });

  it('apos o dispose, instalar de novo volta a abrir', async () => {
    const { installAuthChannel } = await import('./api');
    installAuthChannel()();
    installAuthChannel();
    expect(aberturas).toEqual(['theo-auth', 'theo-auth']);
  });

  it('ambiente sem BroadcastChannel degrada sem lancar', async () => {
    globalThis.BroadcastChannel = (() => {
      throw new Error('indisponivel');
    }) as unknown as typeof BroadcastChannel;

    const { installAuthChannel } = await import('./api');
    expect(() => installAuthChannel()()).not.toThrow();
  });
});
