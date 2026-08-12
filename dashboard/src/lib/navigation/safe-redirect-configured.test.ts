import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * B-214 — caracterização dos ramos que os testes do guarda não alcançavam.
 *
 * `safe-redirect.test.ts` cobre a origem própria, os hosts canônicos e os esquemas hostis. Ficavam
 * de fora dois ramos inteiros — as origens que o OPERADOR configurou (`configuredOrigins`) e o
 * caminho sem `window` — e é justamente onde um refactor de um predicado de segurança pode abrir
 * um buraco sem nenhum teste mudando de cor.
 *
 * Este arquivo é separado porque precisa mockar `@/lib/http/config`, cujos valores são lidos uma
 * vez na carga do módulo — mockar lá dentro afetaria os outros casos.
 */
vi.mock('@/lib/http/config', () => ({
  API_URL: 'https://cloud.exemplo.test',
  AUTH_URL: 'http://auth.local:4433',
  ACCOUNTS_URL: '',
}));

const { isSafeRedirectUrl } = await import('./safe-redirect');

describe('as origens que o operador configurou', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'https://app-dev.usetheo.dev' } });
  });

  it('aceita uma origem configurada em https, fora da lista canônica', () => {
    // Sem este ramo o guarda bricava login, verificação e recuperação em qualquer deployment cujo
    // host de auth não fosse um dos seis literais da lista.
    expect(isSafeRedirectUrl('https://cloud.exemplo.test/x')).toBe(true);
  });

  it('RECUSA a origem configurada em http quando a página está em https — sem downgrade', () => {
    // A regra de recusa vem antes de qualquer permissão: uma página https que redireciona para
    // http joga a navegação em texto claro, e o destino ser confiável não muda isso.
    expect(isSafeRedirectUrl('http://auth.local:4433/self-service/login')).toBe(false);
  });

  it('não aceita um host parecido com o configurado', () => {
    expect(isSafeRedirectUrl('https://cloud.exemplo.test.evil.com/x')).toBe(false);
    expect(isSafeRedirectUrl('https://auth.local:4433/x')).toBe(false);
  });

  it('uma config vazia não vira origem permitida', () => {
    // `ACCOUNTS_URL` é '' aqui. Um bug que empurrasse '' para a lista faria `new URL('')` explodir
    // ou — pior — casar com uma origem vazia.
    expect(isSafeRedirectUrl('')).toBe(false);
  });
});

describe('sem window (SSR / node)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', undefined);
  });

  it('um host canônico continua aceito', () => {
    expect(isSafeRedirectUrl('https://auth-dev.usetheo.dev/x')).toBe(true);
  });

  it('um caminho relativo é RECUSADO — sem origem, não há como julgá-lo', () => {
    // A base só existe quando há `window`. Recusar é o comportamento certo: resolver um caminho
    // relativo contra uma origem que não se conhece seria inventá-la.
    expect(isSafeRedirectUrl('/device-success')).toBe(false);
  });

  it('esquema hostil continua recusado sem window', () => {
    // O primeiro `if` do guarda é condicionado a `typeof window !== 'undefined'`, então este caso
    // depende inteiramente das checagens de origem lá embaixo exigirem http/https.
    expect(isSafeRedirectUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeRedirectUrl('data:text/html,<script>1</script>')).toBe(false);
  });

  it('um host de fora continua recusado sem window', () => {
    expect(isSafeRedirectUrl('https://evil.com/x')).toBe(false);
  });
});

describe('B-214 — numa página http, a origem configurada em http passa', () => {
  beforeEach(() => {
    // Dev local: o dashboard em `http://localhost:5173` e o Kratos noutra porta.
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } });
  });

  it('aceita o host de auth configurado em http', () => {
    // Este ramo existia no código, comentado como raiz de confiança, e NUNCA rodava: o antigo
    // primeiro `if` recusava todo não-https que não fosse mesma origem, e a origem configurada por
    // definição não é a mesma. Um ramo de segurança que nunca executa descreve uma proteção — ou
    // uma permissão — que não existe.
    expect(isSafeRedirectUrl('http://auth.local:4433/self-service/login')).toBe(true);
  });

  it('mas não aceita um host http qualquer', () => {
    expect(isSafeRedirectUrl('http://evil.com/x')).toBe(false);
  });

  it('e continua aceitando https', () => {
    expect(isSafeRedirectUrl('https://cloud.exemplo.test/x')).toBe(true);
    expect(isSafeRedirectUrl('https://auth-dev.usetheo.dev/x')).toBe(true);
  });

  it('mesma origem em http continua valendo', () => {
    expect(isSafeRedirectUrl('http://localhost:5173/projects')).toBe(true);
    expect(isSafeRedirectUrl('/projects')).toBe(true);
  });
});

describe('B-214 — os dois casos que só existem fora de uma página https', () => {
  // Escritos depois de uma varredura de mutação: com a regra anti-downgrade no lugar, mutar o
  // `https:` do allowlist canônico e o padrão de `paginaHttps()` sem window NÃO quebrava nenhum
  // teste. As duas verificações continuavam certas e nada provava isso — inerte é indistinguível
  // de correto até alguém mexer.

  it('numa página http, um host canônico em http continua RECUSADO', () => {
    // O allowlist canônico é https e nada mais: aqueles seis literais nomeiam hosts públicos, e
    // aceitar um deles em texto claro anularia a razão de estarem na lista. A regra
    // anti-downgrade não cobre este caso — a página é http, então não há descida.
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } });
    expect(isSafeRedirectUrl('http://auth-dev.usetheo.dev/x')).toBe(false);
    expect(isSafeRedirectUrl('https://auth-dev.usetheo.dev/x')).toBe(true);
  });

  it('sem window, um destino http é recusado — não se supõe o esquema da página', () => {
    // `paginaHttps()` devolve `true` quando não há window, e é uma escolha, não um acidente: sem
    // saber em que esquema a página está, tratar como https faz a regra anti-downgrade recusar.
    // O oposto (supor http) permitiria texto claro por omissão.
    vi.stubGlobal('window', undefined);
    expect(isSafeRedirectUrl('http://auth.local:4433/x')).toBe(false);
  });
});
