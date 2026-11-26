// Kratos session-based authentication for the LoopScale dashboard.
//
// The dashboard is a first-party SPA — uses Kratos sessions directly.
// No Hydra, no PKCE, no tokens. Just HTTP-only session cookies, validated by
// loop-console (its Backend for Frontend) on every request — getloopscale/loopscale#477.
//
// Hydra is only used for the CLI (Device Code Flow).
//
// SW INVARIANT (T4.2 + EC-04): Service Worker at vite.config.ts MUST never
// cache auth/session endpoints (/api/v1/auth/*, /sessions/*, /self-service/*,
// /oauth2/*). Stale token = security hole (UI shows logged-in but session is
// gone). Always NetworkOnly handler for these patterns.

// AUTH_URL is the dedicated Kratos URL. Falls back to API_URL when AUTH_URL
// isn't set (dev / same-origin). Production with split domains (Kratos at
// accounts.loopscale.dev vs API at api.loopscale.dev) requires AUTH_URL set explicitly
// via /__config.js — without this fallback the auth flow breaks silently.
import { API_URL, AUTH_URL, mocksEnabled } from '@/lib/http/config';
import { reportEvent } from '@/lib/telemetry/rum';
// B-049 — `mocksEnabled` agora vem de ./config (e configuracao, nao fixture).
// `getMockSession` continua vindo de ./dev-mocks: transforma-lo em injecao no
// boot (main.tsx) e o passo 2 da remediacao e fica registrado no item, porque
// muda o ciclo de vida da sessao e merece o seu proprio teste.
import { getMockSession } from '@/lib/mocks/dev-mocks';
import { fetchSessionIdentity } from '@/lib/http/api';
const KRATOS_URL = AUTH_URL || API_URL;

// Os tipos de sessao moram em ./api/types (a ACL de tipos do backend, que nao
// importa nada) para que dev-mocks.ts possa consumir `Session` sem importar
// deste modulo — era esse import de volta que fechava o ciclo (B-039).
// O re-export mantem `@/lib/auth` como superficie publica dos consumidores.
export type { AuthenticationMethod, Session } from '@/lib/api/types';
import type { Session } from '@/lib/api/types';
import { purgarCachesDeDados } from '@/lib/auth/logout-cache-purge';
import { safeNavigator } from '@/lib/navigation';

// OIDC providers whose email verification we trust (MEET-037 security mandate).
const TRUSTED_OIDC_PROVIDERS = ['github', 'google'];

/**
 * Check if the user's email is verified.
 *
 * Three cases:
 * 1. No verifiable_addresses → OIDC user without Kratos-managed email → verified
 * 2. Authenticated via trusted OIDC provider (GitHub/Google) → verified
 *    (provider already verified the email; Kratos marks it unverified because
 *    the mapper doesn't pass email_verified — MEET-037)
 * 3. Otherwise → check verifiable_addresses for at least one verified entry
 */
export function isEmailVerified(session: Session): boolean {
  const addrs = session.identity.verifiable_addresses;
  if (!addrs || addrs.length === 0) return true;

  // If any address is already verified in Kratos, short-circuit
  if (addrs.some(a => a.verified)) return true;

  // Check if authenticated via a trusted OIDC provider
  const methods = session.authentication_methods;
  if (methods) {
    const hasTrustedOIDC = methods.some(
      m => m.method === 'oidc' && TRUSTED_OIDC_PROVIDERS.includes(m.provider ?? ''),
    );
    if (hasTrustedOIDC) return true;
  }

  return false;
}

/** Check if user has an active session. Returns session or null.
 *
 * SECURITY (2026-06-01): Calls Kratos directly via cross-subdomain XHR with
 * credentials:include. Cookie is scoped Domain=getloopscale.com so it travels on
 * same-site (eTLD+1) requests; SameSite=Lax allows this per RFC6265bis §5.5.7.
 * CORS Access-Control-Allow-Origin includes the dashboard origin.
 *
 * If 401 with a stale cookie or missing cookie, returns null and caller
 * (useRequireAuth) routes to /login. Console diagnostics emitted to make
 * "why am I being kicked to /login" actionable in DevTools.
 */
export async function getSession(): Promise<Session | null> {
  // Visual-validation mock layer (dev-only, gated by VITE_USE_MOCKS env var,
  // dead-code-eliminated in production builds). See lib/dev-mocks.ts.
  if (mocksEnabled()) return getMockSession();

  try {
    // The BFF validates the Kratos cookie server-side and returns the identity
    // subset this app reads (GET /v1/auth/session). Going through it — instead
    // of calling Kratos from the browser — keeps devices[].ip_address and
    // recovery_addresses out of the page: they are never sent, so no XSS can
    // read them from here. No token comes back with it (getloopscale/loopscale#477).
    const identity = await fetchSessionIdentity();
    if (!identity) {
      // eslint-disable-next-line no-console
      console.warn(
        `[auth] getSession: no active session (or it could not be checked). ` +
          `If you just registered/logged in but see this, the session cookie may not have been ` +
          `set (open DevTools → Application → Cookies → getloopscale.com and look for ory_kratos_session). ` +
          `Clear cookies and re-login to reset.`,
      );
      return null;
    }
    return {
      active: true,
      identity: {
        id: identity.id,
        traits: { email: identity.email, name: identity.name },
        verifiable_addresses: identity.verifiable_addresses,
      },
      authentication_methods: identity.authentication_methods,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[auth] getSession: network/parse error', err);
    return null;
  }
}

/** Start login flow — redirect to Kratos login UI. */
export function startLogin(): void {
  safeNavigator.goTo(`${KRATOS_URL}/self-service/login/browser`);
}

/** Get verification URL — redirects to Kratos verification flow. */
export function getVerificationURL(): string {
  return `${KRATOS_URL}/self-service/verification/browser`;
}

/** Logout — destroy the Kratos session and notify other tabs. */
export async function logout(): Promise<void> {
  // Broadcast to other tabs (§3.3 + Fix #5). The dashboard holds no token to clear.
  const { announceLogoutAcrossTabs } = await import('@/lib/http/api');
  announceLogoutAcrossTabs();

  // B-055 — apaga o cache do service worker que guarda dado de tenant.
  //
  // Limpar o JWT nao bastava: o Workbox chaveia por URL, e `/api/v1/projects` e
  // a mesma URL para todo mundo. A resposta de quem sai ficava no disco por ate
  // uma hora, e uma falha de rede (ou 3s de timeout) a serviria para quem
  // entrasse depois. Nunca lanca — ver o modulo.
  // B-170 — o relato é consumido, não descartado. Um cache de dados de tenant sobrevivendo ao
  // logout é a falha mais cara desta função, e ela era a única que garantia não contá-la.
  const purga = await purgarCachesDeDados();
  if (purga.sobreviventes.length > 0) {
    reportEvent('logout.cache_purge_incomplete', {
      tentados: purga.tentados,
      sobreviventes: purga.sobreviventes.length,
    });
  }

  // B-139 — o encerramento no SERVIDOR e a navegacao deixaram de ser a mesma coisa.
  //
  // Antes daqui, um Kratos que recusasse o logout, um `logout_url` ausente e um destino que o
  // `safeNavigator` rejeitasse caíam TODOS no mesmo `/login`, indistinguíveis de um logout que
  // funcionou. A pessoa via a tela de login e concluía que tinha saído — com a sessão VIVA no
  // servidor. Num terminal compartilhado é a diferença entre sair e achar que saiu.
  //
  // A navegação para `/login` continua acontecendo em todos os casos, e de propósito: deixar
  // alguém numa tela autenticada com o token local já apagado seria trocar o defeito por um pior.
  // O que muda é que a falha passa a ser DITA — no endereço, para a tela de login mostrar, e na
  // telemetria, para que ela seja contável.
  let encerrouNoServidor = false;
  try {
    const resp = await fetch(`${KRATOS_URL}/self-service/logout/browser`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.logout_url) {
        // B-138: `logout_url` is chosen by the identity service. A refused destination
        // falls through to the `/login` fallback below rather than navigating to it.
        encerrouNoServidor = true;
        if (safeNavigator.goTo(data.logout_url)) return;
      }
    }
  } catch {
    // Rede caiu antes de o Kratos responder: a sessão do servidor pode ou não ter sido encerrada.
    // "Não sabemos" e "não encerrou" pedem a mesma cautela de quem lê.
  }

  if (!encerrouNoServidor) {
    reportEvent('logout.server_session_may_survive', {});
    safeNavigator.goTo('/login?reason=logout-incomplete');
    return;
  }
  safeNavigator.goTo('/login');
}
