import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isSafeRedirectUrl, SAFE_REDIRECT_ORIGINS } from './safe-redirect';

// EC-2 absorption (OWASP A01 — open redirect via Kratos 422+redirect_to):
// the auth service can return a `redirect_browser_to` URL that the client
// follows via window.location.assign. Without same-origin + canonical-host
// allowlisting, a misconfigured or injected response can phishing-redirect
// the user. `isSafeRedirectUrl` is the canonical client-side allowlist.

describe('isSafeRedirectUrl — EC-2 OWASP A01 defense', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { origin: 'https://app-dev.usetheo.dev' },
    });
  });

  it('returns false for empty / null / undefined', () => {
    expect(isSafeRedirectUrl('')).toBe(false);
    expect(isSafeRedirectUrl(null)).toBe(false);
    expect(isSafeRedirectUrl(undefined)).toBe(false);
  });

  it('blocks javascript: protocol', () => {
    expect(isSafeRedirectUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeRedirectUrl('JavaScript:alert(1)')).toBe(false);
  });

  it('blocks data: protocol', () => {
    expect(isSafeRedirectUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('blocks off-origin absolute URLs', () => {
    expect(isSafeRedirectUrl('https://attacker.example/phish')).toBe(false);
    expect(isSafeRedirectUrl('http://localhost:1337/evil')).toBe(false);
  });

  it('accepts same-origin absolute URL', () => {
    expect(isSafeRedirectUrl('https://app-dev.usetheo.dev/billing')).toBe(true);
  });

  it('accepts canonical auth-dev host (Kratos public)', () => {
    expect(
      isSafeRedirectUrl(
        'https://auth-dev.usetheo.dev/self-service/login/methods/oidc/callback/github',
      ),
    ).toBe(true);
  });

  it('accepts canonical prod hosts (future-ready)', () => {
    expect(isSafeRedirectUrl('https://app.usetheo.dev/projects')).toBe(true);
    expect(isSafeRedirectUrl('https://auth.usetheo.dev/self-service/recovery/browser')).toBe(true);
  });

  it('rejects http: against canonical hosts (https-only allowlist)', () => {
    expect(isSafeRedirectUrl('http://app-dev.usetheo.dev/billing')).toBe(false);
  });

  it('rejects malformed URL', () => {
    expect(isSafeRedirectUrl('not a url')).toBe(false);
    expect(isSafeRedirectUrl('://broken')).toBe(false);
  });

  it('SAFE_REDIRECT_ORIGINS exports the allowlist for grep-auditability', () => {
    expect(SAFE_REDIRECT_ORIGINS).toContain('https://auth-dev.usetheo.dev');
    expect(SAFE_REDIRECT_ORIGINS).toContain('https://app-dev.usetheo.dev');
    expect(SAFE_REDIRECT_ORIGINS).toContain('https://auth.usetheo.dev');
    expect(SAFE_REDIRECT_ORIGINS).toContain('https://app.usetheo.dev');
  });
});

/**
 * Caminhos relativos — a classe que o guard rejeitava por engano.
 *
 * `new URL('/x')` lanca sem base, entao `isSafeRedirectUrl('/device-success')`
 * devolvia false: o destino MAIS seguro possivel (mesma origem, sem host) era
 * tratado como hostil. Em producao isso quebraria o fluxo de device-verify
 * inteiro — a pagina existe para seguir o redirect do servidor.
 *
 * Os unitarios nao pegaram porque so exercitavam URLs absolutas. Quem pegou foi
 * o e2e (`e2e/device-verify.spec.ts:57`), cujo mock devolve
 * `redirect_to: '/device-success?simulated=1'`. Vale a lição: um guard testado
 * so com a forma que o autor imaginou é um guard testado pela metade.
 */
describe('safe-redirect — caminhos relativos e as armadilhas ao lado deles', () => {
  it('aceita caminho relativo de mesma origem', () => {
    expect(isSafeRedirectUrl('/device-success')).toBe(true);
    expect(isSafeRedirectUrl('/device-success?simulated=1')).toBe(true);
    expect(isSafeRedirectUrl('/a/b/c#frag')).toBe(true);
  });

  it('RECUSA protocol-relative, que parece caminho e nao e', () => {
    // `//evil.com` resolve para `https://evil.com` sob a origem da pagina — e a
    // armadilha classica de quem trata "comeca com /" como sinonimo de seguro.
    expect(isSafeRedirectUrl('//evil.com')).toBe(false);
    expect(isSafeRedirectUrl('//evil.com/path')).toBe(false);
  });

  it('RECUSA esquemas hostis mesmo com a base presente', () => {
    expect(isSafeRedirectUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeRedirectUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });
});

describe('B-214 — o invariante da lista canônica', () => {
  it('toda origem canônica é https', () => {
    // É este invariante que faz a comparação de origens rejeitar `http://auth-dev.usetheo.dev`
    // sem nenhuma verificação de protocolo no predicado: a origem carrega o esquema. Uma entrada
    // http na lista abriria um destino em texto claro sem que nada no guarda reclamasse — então a
    // afirmação mora aqui, junto da lista, e não espalhada em `if`s redundantes.
    for (const origem of SAFE_REDIRECT_ORIGINS) {
      expect(origem, `${origem} deveria ser https`).toMatch(/^https:\/\//);
    }
  });

  it('nenhuma entrada traz caminho, query ou barra final — origem é só esquema://host:porta', () => {
    // `url.origin` nunca inclui caminho. Uma entrada como `https://auth.usetheo.dev/` jamais
    // casaria, e o host ficaria silenciosamente fora do allowlist.
    for (const origem of SAFE_REDIRECT_ORIGINS) {
      expect(new URL(origem).origin, `${origem} não está na forma de origem`).toBe(origem);
    }
  });
});
