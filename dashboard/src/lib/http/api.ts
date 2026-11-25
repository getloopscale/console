// API client for the Theo dashboard.
//
// Auth (Backend for Frontend, usetheoai/theo#477 step 3):
//   The browser holds NO token. It keeps the Kratos session cookie, which the
//   browser sends on every same-origin request; theo-cloud validates it
//   server-side on each call and holds any downstream credential itself.
//   There is nothing here to steal, refresh, expire or broadcast.
//
// §3.3: BroadcastChannel coordinates logout across browser tabs.
// §3.6: Session expiry shows notification before redirect.

// MEET-040: Single origin. Dashboard served at cloud.{domain} — all API calls are relative.
// Runtime config via /__config.js (empty in prod = same-origin, set per-env in container).
import { API_URL, mocksEnabled } from './config';
import { isLoggedOutMessage, readPlanLimitDetail } from './event-payloads';
import { redirectToLogin } from './session-redirect';

const API_BASE = API_URL;

export function getApiBase() { return API_BASE; }

/**
 * Typed error thrown by `cloudFetch`/`engineFetch` ONLY when the caller opts in
 * via `{ throwOnError: true }`. Carries the HTTP `status` (+ parsed `body` when
 * available) so call-sites can tailor copy (404 "not configured" vs 5xx "retry")
 * and React Query routes it to `isError`. A network failure surfaces as
 * `status: 0`. The DEFAULT (`T | null`) path never throws — see `cloudFetch`.
 *
 * @see .claude/knowledge-base/plans/dashboard-memory-error-surfacing-plan.md § T1.1 (ADR D3)
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body?: unknown;
  constructor(status: number, body?: unknown, message?: string) {
    super(message ?? `API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** Opt-in behavior flags for `cloudFetch`/`engineFetch`. */
export interface CloudFetchConfig {
  /**
   * When true, a non-2xx response (after the 401-refresh retry) and a network
   * rejection throw an {@link ApiError} instead of resolving to `null`. Opt-in
   * so the existing `T | null` callers (queries that treat null as "no data")
   * are unaffected; surfaces with `isError`/error-boundary handling pass it.
   */
  readonly throwOnError?: boolean;
  /**
   * Chamado com a Response BEM-SUCEDIDA, antes do corpo ser parseado e a resposta descartada.
   *
   * Existe porque algumas respostas carregam informação de produto nos HEADERS — o
   * `Link … rel="next"` do catálogo de prompts é a primeira (M13). Antes disto, ler um header
   * exigia `cloudFetchRaw`, que NÃO reproduz o refresh-e-retry no 401, o interceptor de 402 nem
   * o erro tipado de rede: a tela que o usasse quebraria numa expiração de sessão onde a tela
   * vizinha se recupera. Um callback aqui dá acesso ao header mantendo UM pipeline de auth.
   */
  readonly onResponse?: (resp: Response) => void;
}

/**
 * Credentials for every call: the session cookie, and only to our own origin.
 *
 * `same-origin`, not `include`: the dashboard is served from the API's origin (MEET-040), and
 * `include` would send the cookie to any other origin configured in `API_URL` — exactly the
 * request the server refuses as cross-origin.
 */
const CREDENTIALS: RequestCredentials = 'same-origin';

// §3.3: BroadcastChannel for cross-tab coordination. Only logout crosses it — it carries no
// secret, and since usetheoai/theo#477 step 3 there is no secret in this tab to carry anyway.
let authChannel: BroadcastChannel | null = null;

/**
 * Opens the cross-tab coordination channel. Called ONCE at boot (main.tsx).
 *
 * B-042 — the channel used to open as a side effect of IMPORTING this module. Its lifecycle is
 * explicit now and the function returns its own dispose. Idempotent on purpose.
 */
export function installAuthChannel(): () => void {
  if (authChannel) return () => {};
  try {
    const ch = new BroadcastChannel('loopscale-auth');
    ch.onmessage = (event: MessageEvent<unknown>) => {
      // B-234 — the payload comes from another running tab; only the exact logout shape acts.
      if (!isLoggedOutMessage(event.data)) return;
      // Another tab logged out: the shared session cookie is gone, so this tab's is too.
      lastSessionStatus = 401;
      redirectToLogin('expired');
    };
    authChannel = ch;
    return () => {
      ch.close();
      if (authChannel === ch) authChannel = null;
    };
  } catch {
    // BroadcastChannel not available (e.g., some workers) — graceful degradation
    return () => {};
  }
}

// #324: HTTP status of the LAST session probe (null = network rejection, no response). It is not
// authentication state — it is the difference between "try again soon" and "you were signed out".
let lastSessionStatus: number | null = null;
let sessionProbe: Promise<SessionIdentity | null> | null = null; // Dedup concurrent probes

/** The identity behind the session cookie, as GET /v1/auth/session returns it. */
export interface SessionIdentity {
  id: string;
  email: string;
  name?: string;
  verifiable_addresses?: { value: string; verified: boolean; via: string }[];
  authentication_methods?: { method: string; provider?: string }[];
}

/**
 * Asks the BFF whose session the cookie carries. `null` when there is no session OR when it could
 * not be determined — `sessionDefinitivelyExpired()` tells the two apart.
 *
 * The BFF validates the cookie against Kratos and returns only the subset the dashboard reads, so
 * devices[].ip_address and recovery_addresses never reach the page. Concurrent calls share one
 * request.
 */
export async function fetchSessionIdentity(): Promise<SessionIdentity | null> {
  if (mocksEnabled()) {
    lastSessionStatus = 200;
    return { id: 'mock-identity', email: 'mock@example.com' };
  }
  if (sessionProbe) return sessionProbe;
  sessionProbe = (async () => {
    try {
      const resp = await fetch(`${API_BASE}/v1/auth/session`, {
        credentials: CREDENTIALS,
        headers: { Accept: 'application/json' },
      });
      lastSessionStatus = resp.status;
      if (!resp.ok) return null;
      const data = (await resp.json()) as { identity?: SessionIdentity };
      return data.identity ?? null;
    } catch {
      // Network rejection: with no response nothing says the session ended. Safe side.
      lastSessionStatus = null;
      return null;
    } finally {
      sessionProbe = null;
    }
  })();
  return sessionProbe;
}

/**
 * #324 — has the session ENDED? The terminal side has one member: `401 AUTH_REQUIRED`, which the
 * BFF emits only when Kratos refuses the cookie. 429, 5xx, 502 (AUTH_SERVICE_UNAVAILABLE) and a
 * network failure fall on the safe side — try again, never sign out. Keeps #110 closed: a stale
 * cookie → 401 → redirect.
 */
export function sessionDefinitivelyExpired(): boolean {
  return lastSessionStatus === 401;
}

/**
 * B-142 — the error carries the status that actually happened, because `retryGuard` decides by it
 * and refuses to retry a 4xx.
 */
function transientAuthError(): ApiError {
  const status = lastSessionStatus ?? 0;
  return new ApiError(
    status,
    undefined,
    status === 0
      ? 'could not reach the authentication service — no response'
      : `authentication service returned ${String(status)} — try again in a moment`,
  );
}

/** Tells the other tabs this session ended. Ends nothing on the server. */
export function announceLogoutAcrossTabs(): void {
  // §3.3: Broadcast logout to all tabs
  authChannel?.postMessage({ type: 'logged-out' });
}

// MEET-040: Unified API fetch. All paths relative to same origin.
// /v1/billing, /v1/auth/* → cloud service (direct, same origin)
// /engine/api/v1/* → cloud service proxy → engine API (BFF pattern)
/**
 * B-235 — no contrato PADRAO, `null` colapsa cinco desfechos: falha transitoria de auth, sessao
 * encerrada, nao-2xx, rejeicao de rede e um `204`/`205` **bem-sucedido**. O quinto virou defeito
 * visivel em `useCloudApi` (B-171), corrigido la com o erro tipado. O default segue ambiguo e
 * **nao e item fechado** — discriminar quebra 151 importadores; ver
 * `plans/http-error-contract-plan.md § Unresolved Questions`. Codigo novo passa `throwOnError`.
 */
export async function cloudFetch<T>(path: string, options: RequestInit = {}, cfg: CloudFetchConfig = {}): Promise<T | null> {
  // Plan v1.0 (2026-05-26): mock mode wraps window.fetch (lib/mocks/server.ts); this flow is
  // identical in mock and prod — the difference is purely WHO answers the network call.
  return fetchWithSession<T>(path, options, cfg.throwOnError === true, cfg.onResponse);
}

// Engine API calls proxied through cloud service.
export async function engineFetch<T>(path: string, options: RequestInit = {}, cfg: CloudFetchConfig = {}): Promise<T | null> {
  return cloudFetch<T>(`/engine${path}`, options, cfg);
}

/**
 * Authenticated raw fetch that returns the {@link Response} instead of parsing a
 * JSON body — for non-JSON payloads like file downloads/previews (bytes/text/blob).
 * Carries the same session cookie the JSON path does. Returns null (and redirects
 * to login) when the session has ended; a network rejection propagates.
 */
export async function cloudFetchRaw(path: string, options: RequestInit = {}): Promise<Response | null> {
  const resp = await fetch(`${API_BASE}${path}`, { ...options, credentials: CREDENTIALS });
  if (resp.status === 401 && (await signOutIfSessionEnded())) return null;
  return resp;
}

/**
 * A 401 on a data call SUGGESTS the session ended; the probe decides. A 401 can come from
 * elsewhere (the engine behind the proxy), and only the probe tells "the cookie died" from "this
 * call was refused".
 */
async function sessionEnded(): Promise<boolean> {
  await fetchSessionIdentity();
  return sessionDefinitivelyExpired();
}

/**
 * For callers outside this module that saw a 401/403 (the SSE streams): probe the session and, if
 * it ended, take the person to /login. Resolves `true` when it redirected.
 */
export async function signOutIfSessionEnded(): Promise<boolean> {
  if (!(await sessionEnded())) return false;
  redirectToLogin('expired');
  return true;
}

/**
 * Parse a 2xx response body, tolerating an empty body. A 204/205 No Content
 * (e.g. a successful DELETE) carries no body — calling `resp.json()` on it throws,
 * which the catch-all would mistake for a network failure. Return `null` for those
 * instead. (M75 regression — a successful delete surfaced as "Could not delete".)
 */
async function parseOkBody<T>(resp: Response): Promise<T | null> {
  if (resp.status === 204 || resp.status === 205) return null;
  return (await resp.json()) as T;
}

/** Build a typed ApiError from a non-2xx response (best-effort JSON body). */
async function toApiError(resp: Response): Promise<ApiError> {
  let body: unknown;
  try { body = await resp.clone().json(); } catch { /* non-JSON body — leave undefined */ }
  return new ApiError(resp.status, body);
}

async function fetchWithSession<T>(path: string, options: RequestInit, throwOnError: boolean, onResponse?: (resp: Response) => void): Promise<T | null> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  // T5.0 of plan 2026-05-27-backend-frontend-integration v1.1 (EC-09).
  // Auto-generate Idempotency-Key for every mutating verb so retries on
  // network blips do not duplicate state. Caller can override with an
  // explicit `headers['Idempotency-Key']` to make a deliberate replay.
  const method = (options.method || 'GET').toUpperCase();
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && !headers['Idempotency-Key']) {
    headers['Idempotency-Key'] = crypto.randomUUID();
  }
  const send = () => fetch(`${API_BASE}${path}`, { ...options, headers, credentials: CREDENTIALS });

  try {
    let resp = await send();
    if (resp.status === 401) {
      await fetchSessionIdentity();
      if (sessionDefinitivelyExpired()) {
        redirectToLogin('expired');
        // F-api-1: under throwOnError the expiry surfaces as ApiError(401), so an opted-in
        // mutation rejects (the form is retained) instead of resolving null → onSuccess.
        if (throwOnError) throw new ApiError(401, undefined, 'session expired — re-authentication required');
        return null;
      }
      // #324: the probe could not answer (quota, 5xx, network). That is not a sign-out.
      if (lastSessionStatus !== 200) {
        if (throwOnError) throw transientAuthError();
        return null;
      }
      // The session is alive: the 401 belonged to this call, not to the cookie. One retry covers
      // the race where Kratos renewed the session between the send and the response.
      resp = await send();
    }
    if (!resp.ok) {
      await maybeEmitPaymentRequired(resp);
      if (throwOnError) throw await toApiError(resp);
      return null;
    }
    onResponse?.(resp);
    return await parseOkBody<T>(resp);
  } catch (err) {
    // Re-throw our own typed error (don't let the catch-all swallow it back to null).
    if (err instanceof ApiError) throw err;
    // Network failure (fetch rejected): surface as ApiError(0) when opted in,
    // else preserve the legacy silent-null contract.
    if (throwOnError) throw new ApiError(0, undefined, 'network request failed');
    return null;
  }
}

/**
 * Plan J-10 v1.1 T1.4 — 402 interceptor.
 *
 * When the backend rejects with HTTP 402 (`PLAN_LIMIT_EXCEEDED` or related),
 * emit a global window event `loopscale:plan-limit` so a top-level
 * <PlanLimitUpgradeModal> can listen + open the upgrade flow without each
 * call site re-implementing the logic. Idempotent: the event carries the
 * typed error payload so the modal can show "Upgrade to Pro for more
 * environments" with context-specific copy.
 *
 * Rationale per blueprint § 2.5 Pattern A (Vercel canonical inline modal):
 * direct path to conversion, no friction navigation away from current
 * surface. The 402 is the canonical signal; tying the modal to the event
 * means /environments + /secrets + /projects + future surfaces all get
 * the upgrade modal for free.
 */
async function maybeEmitPaymentRequired(resp: Response): Promise<void> {
  if (resp.status !== 402) return;
  if (typeof window === 'undefined') return; // SSR / test envs without window
  try {
    const body: unknown = await resp.clone().json();
    // B-236 — o corpo seguia sem exame ate `String.replace` no modal, onde um `current_plan`
    // numerico lancava dentro de um handler do React. A fronteira e aqui.
    window.dispatchEvent(
      new CustomEvent('loopscale:plan-limit', { detail: readPlanLimitDetail(body) }),
    );
  } catch {
    // Body not JSON — still emit the event so modal opens with generic copy.
    window.dispatchEvent(new CustomEvent('loopscale:plan-limit', { detail: null }));
  }
}
// build trigger 1775591972
