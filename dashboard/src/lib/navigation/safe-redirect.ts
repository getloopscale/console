import { ACCOUNTS_URL, API_URL, AUTH_URL } from '@/lib/http/config';

/**
 * isSafeRedirectUrl — OWASP A01 boundary helper for server-supplied
 * redirect URLs (e.g., Kratos 422 + redirect_browser_to).
 *
 * Plan v1.1 Phase 3 Task T3.3 / EC-2 absorption (open-redirect via
 * 422+redirect_to). Kratos itself enforces allowlisting at the config
 * level, but client-side defense-in-depth is canonical: a misconfigured
 * auth service OR an injected response cannot phishing-redirect the user.
 *
 * Allowlist rule:
 *   - URL parses successfully via `new URL(url)`, AND
 *   - protocol is `https:` (canonical hosts) OR matches `window.location.origin`, AND
 *   - origin is one of `SAFE_REDIRECT_ORIGINS` OR equals `window.location.origin`
 *
 * The allowlist is exported as a const for grep-auditability — code
 * review can verify the set without parsing the function body.
 */
/**
 * Origins the OPERATOR configured. `docker-entrypoint.sh` validates these and they are not
 * response-supplied, so they are a trust root in a way `flow.ui.action` never is. Without
 * them the boundary silently bricked login, verification and recovery on any deployment
 * whose auth host is not one of the six literals below — including
 * `https://accounts.usetheo.dev`, the topology `kratos.ts` documents in its own comment.
 */
function configuredOrigins(): string[] {
  const out: string[] = [];
  for (const raw of [API_URL, AUTH_URL, ACCOUNTS_URL]) {
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (u.protocol === 'https:' || u.protocol === 'http:') out.push(u.origin);
    } catch {
      // Not an absolute url — same-origin config, already covered.
    }
  }
  return out;
}

export const SAFE_REDIRECT_ORIGINS: readonly string[] = [
  // Dev-public canonical hosts (per Caddy / Cloudflare wildcard chain).
  'https://auth-dev.usetheo.dev',
  'https://app-dev.usetheo.dev',
  'https://cloud-dev.usetheo.dev',
  // Production hosts (future-ready; harmless on dev because window.origin won't match).
  'https://auth.usetheo.dev',
  'https://app.usetheo.dev',
  'https://cloud.usetheo.dev',
];

/**
 * B-031 — este guard SUBSUMIU `sanitizeReturnTo` (`lib/auth/return-to.ts`),
 * apagado em 2026-08-07.
 *
 * Os dois respondiam a mesma pergunta — "e seguro navegar para esta URL?" — com
 * formatos diferentes: aquele devolvia uma string ja saneada, com fallback para
 * `/projects`; este e um predicado e deixa a decisao com quem chama.
 *
 * Ter DUAS respostas para uma pergunta de seguranca e risco por si so: quem
 * chega pega a que encontrar primeiro, e as duas divergem em silencio ao longo
 * do tempo. Este ficou porque tem consumidor de producao (`device-verify.tsx`,
 * que antes navegava cru para uma URL vinda da resposta do servidor); o outro
 * nunca teve, e nao havia vetor ativo — medido duas vezes: os tres usos de
 * `return_to` no repo ESCREVEM a URL com o proprio origin, e nenhum LE uma
 * externa para navegar.
 *
 * ## A diferenca que nao pode se perder
 *
 * `sanitizeReturnTo` aceitava APENAS mesma origem. Este aceita tambem os hosts
 * canonicos de `SAFE_REDIRECT_ORIGINS` (Kratos publico) — necessario para o
 * fluxo de autenticacao, e mais permissivo do que aquele era.
 *
 * Se um dia alguem precisar sanear um `return_to` que chega de link externo
 * (e-mail, share), a pergunta a fazer NAO e "posso usar este guard?" e sim "o
 * allowlist de origens vale para ESTE destino?". Para um `return_to` pos-login,
 * provavelmente sim. Para um destino arbitrario, provavelmente nao — e ai o
 * certo e um segundo predicado com allowlist propria, nao afrouxar este.
 */
export function isSafeRedirectUrl(raw: string | null | undefined): boolean {
  if (raw == null || raw === '') {
    return false;
  }
  let url: URL;
  try {
    // BASE OBRIGATORIA. Sem ela, `new URL('/device-success')` LANCA — um caminho
    // relativo nao tem origem — e o guard rejeitava o destino mais seguro que
    // existe: mesma origem, sem host. O e2e pegou (`device-verify.spec.ts:57`);
    // os testes unitarios nao, porque so exercitavam URLs absolutas.
    //
    // Com a base, a checagem de origem abaixo continua fazendo todo o trabalho:
    // `/device-success` resolve para a propria origem e passa; `//evil.com`
    // resolve para `https://evil.com` e e recusado como qualquer outro host de
    // fora. Um caminho relativo NAO ganha excecao — ele so passa a ser resolvido
    // antes de ser julgado.
    // A base so entra quando a entrada COMECA com `/`. Aplicar base a qualquer
    // string tornaria `'not a url'` valido — ele resolveria para
    // `<origem>/not%20a%20url`, que e mesma origem e portanto "seguro", mas
    // navegar para lixo nao e o comportamento certo: entrada malformada deve
    // virar erro visivel, nao uma navegacao silenciosa para um 404.
    //
    // `//evil.com` tambem comeca com `/` e recebe a base — de proposito: ele
    // resolve para `https://evil.com` e e recusado pela checagem de origem, que
    // e onde essa decisao pertence. Nao existe atalho "comeca com / logo e
    // seguro"; a resolucao acontece antes do julgamento, nunca no lugar dele.
    const base =
      raw.startsWith('/') && typeof window !== 'undefined' ? window.location.origin : undefined;
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return false;
  }
  // Reject any non-https scheme against the allowlist; same-origin can
  // also be http during local dev — handled by the origin compare below.
  if (url.protocol !== 'https:' && typeof window !== 'undefined') {
    // Same-origin http (local dev) is honored ONLY when the page itself
    // is on http (mirrors the location origin). On https pages, http
    // redirects are not safe.
    if (window.location.origin !== url.origin) {
      return false;
    }
  }
  if (typeof window !== 'undefined' && url.origin === window.location.origin) {
    return true;
  }
  // The configured hosts count too — see `configuredOrigins`. Operator-supplied config is a
  // trust root; a Kratos response is not.
  if (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    configuredOrigins().includes(url.origin)
  ) {
    return true;
  }
  if (url.protocol === 'https:' && SAFE_REDIRECT_ORIGINS.includes(url.origin)) {
    return true;
  }
  return false;
}
