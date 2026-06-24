// API client for the Theo dashboard.
//
// Auth flow (BFF pattern):
//   1. Dashboard authenticates via Kratos (session cookies)
//   2. POST /v1/auth/session/token exchanges cookies → JWT
//   3. All API calls use Authorization: Bearer <jwt>
//
// §3.3: BroadcastChannel coordinates token state across browser tabs.
// §3.6: Session expiry shows notification before redirect.

// MEET-040: Single origin. Dashboard served at cloud.{domain} — all API calls are relative.
// Runtime config via /__config.js (empty in prod = same-origin, set per-env in container).
import { API_URL } from './config';
import { mocksEnabled } from './dev-mocks';
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
}

// In-memory JWT token (never localStorage — XSS risk)
let accessToken: string | null = null;
let tokenExpiresAt = 0;
let refreshPromise: Promise<boolean> | null = null; // Dedup concurrent refreshes

// §3.3: BroadcastChannel for cross-tab coordination.
// SECURITY: the JWT is NEVER broadcast. The token lives only in this tab's
// memory; broadcasting it would let any same-origin XSS subscribe to the channel
// and exfiltrate tokens from every open tab. Each tab mints its own token from
// its own Kratos session cookie via exchangeSessionToken(). Only logout (which
// carries no secret) is coordinated across tabs.
type AuthMessage = { type: 'logged-out' };

let authChannel: BroadcastChannel | null = null;
try {
  authChannel = new BroadcastChannel('theo-auth');
  authChannel.onmessage = (event: MessageEvent<AuthMessage>) => {
    const msg = event.data;
    if (msg.type === 'logged-out') {
      // Another tab logged out — clear this tab's token and redirect.
      accessToken = null;
      tokenExpiresAt = 0;
      redirectToLogin('expired');
    }
  };
} catch {
  // BroadcastChannel not available (e.g., some workers) — graceful degradation
}

/** Exchange Kratos session cookie for a JWT. Called after login. */
export async function exchangeSessionToken(): Promise<boolean> {
  // Visual-validation mock layer (dev-only, gated by VITE_USE_MOCKS).
  // Set a fake token so hasValidToken() returns true and the dashboard
  // proceeds without trying to hit the real BFF endpoint.
  if (mocksEnabled()) {
    accessToken = 'mock-jwt-for-visual-validation';
    tokenExpiresAt = Date.now() + 3600 * 1000;
    return true;
  }

  // Dedup: if a refresh is already in flight, reuse it
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const resp = await fetch(`${API_BASE}/v1/auth/session/token`, {
        method: 'POST',
        credentials: 'include', // Send Kratos session cookie
        headers: { 'Content-Type': 'application/json' },
      });
      if (!resp.ok) return false;

      const data = await resp.json() as { access_token: string; expires_in: number };
      accessToken = data.access_token;
      tokenExpiresAt = Date.now() + (data.expires_in * 1000) - 60000; // 60s buffer

      // SECURITY: do NOT broadcast the token. Each tab exchanges its own token
      // from its Kratos session cookie on demand (see ensureToken).
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/** Check if we have a valid token. */
export function hasValidToken(): boolean {
  return accessToken !== null && Date.now() < tokenExpiresAt;
}

/** Ensure we have a valid token, refreshing if needed. */
async function ensureToken(): Promise<string | null> {
  if (hasValidToken()) return accessToken;
  const ok = await exchangeSessionToken();
  return ok ? accessToken : null;
}

/**
 * Exposed for SSE consumers (use-log-stream) that need the JWT inline in
 * the URL query string because EventSource cannot set headers.
 * T6.0 of plan 2026-05-27-backend-frontend-integration v1.1 (EC-04).
 */
export async function ensureSSEToken(): Promise<string | null> {
  return ensureToken();
}

let redirecting = false;

/** §3.6: Show notification before redirect, with reason in query param. */
function redirectToLogin(reason?: string): void {
  if (redirecting) return;
  redirecting = true;

  const params = reason ? `?reason=${reason}` : '';

  // §3.6: Brief delay so user sees the notification
  if (reason === 'expired') {
    // Show a visible indicator before redirect
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;top:16px;right:16px;background:#1a1a1a;color:white;padding:12px 20px;border-radius:8px;z-index:9999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    toast.textContent = 'Session expired. Redirecting to login...';
    document.body.appendChild(toast);
    setTimeout(() => { window.location.href = `/login${params}`; }, 2000);
  } else {
    window.location.href = `/login${params}`;
  }
}

/** Clear token (on logout or login page visit). */
export function clearToken(): void {
  accessToken = null;
  tokenExpiresAt = 0;
}

/** Logout — clears token and broadcasts to other tabs. */
export function logout(): void {
  clearToken();
  // §3.3: Broadcast logout to all tabs
  authChannel?.postMessage({ type: 'logged-out' } satisfies AuthMessage);
}

// MEET-040: Unified API fetch. All paths relative to same origin.
// /v1/billing, /v1/auth/* → cloud service (direct, same origin)
// /engine/api/v1/* → cloud service proxy → engine API (BFF pattern)
export async function cloudFetch<T>(path: string, options: RequestInit = {}, cfg: CloudFetchConfig = {}): Promise<T | null> {
  // Plan v1.0 (2026-05-26): mock mode no longer short-circuits via FIXTURES
  // map. Instead, lib/mocks/server.ts wraps window.fetch and intercepts all
  // /api/v1/* paths transparently — covering 47+ endpoints vs the old 5.
  // The cloudFetch flow stays identical in mock + prod modes; the difference
  // is purely WHO answers the network call.
  const token = await ensureToken();
  if (!token) {
    redirectToLogin('expired');
    return null;
  }
  return fetchWithAuth<T>(API_BASE, path, token, options, true, cfg.throwOnError === true);
}

// Alias for backward compatibility during migration
export { cloudFetch as apiFetch };

// Engine API calls proxied through cloud service.
export async function engineFetch<T>(path: string, options: RequestInit = {}, cfg: CloudFetchConfig = {}): Promise<T | null> {
  return cloudFetch<T>(`/engine${path}`, options, cfg);
}

/** Build a typed ApiError from a non-2xx response (best-effort JSON body). */
async function toApiError(resp: Response): Promise<ApiError> {
  let body: unknown;
  try { body = await resp.clone().json(); } catch { /* non-JSON body — leave undefined */ }
  return new ApiError(resp.status, body);
}

async function fetchWithAuth<T>(base: string, path: string, token: string, options: RequestInit = {}, redirectOnAuthFailure = true, throwOnError = false): Promise<T | null> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(options.headers as Record<string, string> || {}),
  };

  // T5.0 of plan 2026-05-27-backend-frontend-integration v1.1 (EC-09).
  // Auto-generate Idempotency-Key for every mutating verb so retries on
  // network blips do not duplicate state. Caller can override with an
  // explicit `headers['Idempotency-Key']` to make a deliberate replay
  // (e.g., resume across reload).
  const method = (options.method || 'GET').toUpperCase();
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && !headers['Idempotency-Key']) {
    headers['Idempotency-Key'] = crypto.randomUUID();
  }

  try {
    const resp = await fetch(`${base}${path}`, { ...options, headers });
    if (resp.status === 401) {
      if (!redirectOnAuthFailure) return null;
      // Token expired — try refresh once
      accessToken = null;
      const newToken = await ensureToken();
      if (!newToken) {
        redirectToLogin('expired');
        // Coherent error contract (F-api-1): under throwOnError the auth-expiry
        // surfaces as ApiError(401) so an opted-in mutation rejects → isError
        // (the form is retained) rather than resolving null → onSuccess (which
        // would silently clear it). The redirect still fires regardless.
        if (throwOnError) throw new ApiError(401, undefined, 'session expired — re-authentication required');
        return null;
      }
      // Retry with new token
      headers['Authorization'] = `Bearer ${newToken}`;
      const retry = await fetch(`${base}${path}`, { ...options, headers });
      if (!retry.ok) {
        await maybeEmitPaymentRequired(retry);
        if (throwOnError) throw await toApiError(retry);
        return null;
      }
      return await retry.json() as T;
    }
    if (!resp.ok) {
      await maybeEmitPaymentRequired(resp);
      if (throwOnError) throw await toApiError(resp);
      return null;
    }
    return await resp.json() as T;
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
 * emit a global window event `theo:plan-limit` so a top-level
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
    const body = await resp.clone().json();
    window.dispatchEvent(
      new CustomEvent('theo:plan-limit', { detail: body }),
    );
  } catch {
    // Body not JSON — still emit the event so modal opens with generic copy.
    window.dispatchEvent(new CustomEvent('theo:plan-limit', { detail: null }));
  }
}
// build trigger 1775591972
