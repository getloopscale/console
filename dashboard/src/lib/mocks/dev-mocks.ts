// Visual-validation mock layer for the Theo dashboard.
//
// Activated only when `import.meta.env.VITE_USE_MOCKS === 'true'`. Returns
// seeded fixtures for session + every cloudFetch/engineFetch path so all 13
// dashboard routes render with realistic data, WITHOUT a running Kratos +
// engine API + cloud backend.
//
// Purpose: closes the T-H.1 visual smoke gap from MEET-ASYNC-001 without
// requiring `task setup` + `tilt up` (which is 15-25min cold start).
//
// Each fixture comments the TS source-of-truth shape it satisfies so future
// drift between mock and real backend stays visible in code review.
//
// **NOT** for tests (those use vi.mock at the hook layer). **NOT** for prod
// (gated by env var at boot — `mocksEnabled()` returns false unless VITE_USE_MOCKS
// is set, and Vite's dead-code-elimination drops the import in prod builds
// because the env var is statically resolvable at build time).

import type { Session } from '@/lib/api/types';

// B-049 — `mocksEnabled` mora em ./config para que api.ts e auth.ts (producao)
// nao precisem importar deste modulo de fixtures. Re-exportado aqui porque os
// consumidores internos e o harness de e2e ja o pegavam por este caminho.
export { mocksEnabled } from '@/lib/http/config';
import { mocksEnabled } from '@/lib/http/config';

/**
 * Logged-out mock mode — when `VITE_USE_MOCKS=true` AND EITHER the build-time
 * `VITE_MOCK_LOGGED_OUT=true` env is set OR the runtime flag
 * `window.__LOOPSCALE_MOCK_LOGGED_OUT === true` is present, `getMockSession()`
 * returns null so auth pages (login, register, recovery, verification) render
 * their forms instead of redirecting to / per the session-gate logic.
 *
 * The build-time env is a whole-server mode (visual validation of all 5 auth
 * surfaces). The runtime flag is a PER-PAGE override for hermetic Playwright
 * e2e: the global webServer runs logged-IN (so dashboard specs work), and an
 * auth-page spec sets `window.__LOOPSCALE_MOCK_LOGGED_OUT = true` via
 * `page.addInitScript(...)` BEFORE app load so only that page renders logged-out.
 * Without this, every auth-page e2e redirected to the mock dashboard. Dev-only
 * (gated by mocksEnabled → dead-code-eliminated in production). (Plan T-B.1,
 * ADR-D2; runtime override added M0 J-01 e2e harness fix.)
 */

export function mocksLoggedOut(): boolean {
  if (!mocksEnabled()) return false;
  if (import.meta.env.VITE_MOCK_LOGGED_OUT === 'true') return true;
  return (
    typeof window !== 'undefined' &&
    (window as unknown as { __LOOPSCALE_MOCK_LOGGED_OUT?: boolean }).__LOOPSCALE_MOCK_LOGGED_OUT === true
  );
}

/**
 * Fixture: a fully-authenticated session with a verified email — UNLESS
 * `VITE_MOCK_LOGGED_OUT=true`, in which case returns null to simulate
 * "no session" (useRequireAuth then keeps user on /login or wherever they
 * landed).
 */
export function getMockSession(): Session | null {
  if (mocksLoggedOut()) return null;
  return {
    active: true,
    identity: {
      id: 'mock-user-uuid-0000-0000',
      traits: {
        email: 'demo@example.com',
        name: 'Demo Operator',
      },
      verifiable_addresses: [
        { value: 'demo@example.com', verified: true, via: 'email' },
      ],
    },
    authentication_methods: [
      { method: 'password', completed_at: '2026-05-25T08:00:00Z' },
    ],
  };
}

// Path → mock response map. Keys match what cloudFetch/engineFetch receive
// AFTER the `/engine` prefix is added by engineFetch (so engineFetch('/api/v1/x')
// looks up '/engine/api/v1/x' here).
const FIXTURES: Record<string, unknown> = {
  // -- /v1/billing (BillingResponse from pages/billing.tsx) ----------------
  '/v1/billing': {
    plan: 'pro',
    team: 'acme',
    period_start: '2026-05-01T00:00:00Z',
    period_end: '2026-05-31T23:59:59Z',
    usage: {
      'Fast Data Transfer': { used: 412, limit: 1000 },
      'Fast Origin Transfer': { used: 87, limit: 250 },
      'Edge Requests': { used: 1_240_000, limit: 10_000_000 },
      'Build Minutes': { used: 145, limit: 400 },
      'Concurrent Builds': { used: 2, limit: 4 },
    },
  },

  // -- /engine/api/v1/projects (ProjectsResponse from hooks/use-projects.ts)
  '/engine/api/v1/projects': {
    projects: [
      {
        name: 'acme-web',
        environment: 'production',
        last_deploy: '2026-05-25T06:42:00Z',
        apps: [
          { name: 'frontend', type: 'web', framework: 'next', status: 'live' },
          { name: 'api', type: 'service', framework: 'go', status: 'live' },
        ],
      },
      {
        name: 'acme-payments',
        environment: 'production',
        last_deploy: '2026-05-24T19:11:00Z',
        apps: [
          { name: 'stripe-webhook', type: 'service', framework: 'go', status: 'live' },
        ],
      },
      {
        name: 'acme-marketing',
        environment: 'staging',
        last_deploy: '2026-05-23T14:30:00Z',
        apps: [
          { name: 'landing', type: 'web', framework: 'astro', status: 'building' },
        ],
      },
      {
        name: 'acme-internal-tools',
        environment: 'production',
        last_deploy: '2026-05-20T09:15:00Z',
        apps: [
          { name: 'dashboard', type: 'web', framework: 'vite', status: 'live' },
          { name: 'cron-worker', type: 'job', framework: 'node', status: 'live' },
        ],
      },
      {
        name: 'acme-experiments',
        environment: 'preview',
        last_deploy: '2026-05-19T22:08:00Z',
        apps: [
          { name: 'a-b-test', type: 'web', framework: 'remix', status: 'idle' },
        ],
      },
    ],
  },

  // -- /engine/api/v1/domains (DomainsResponse from pages/domains.tsx) -----
  '/engine/api/v1/domains': {
    total: 4,
    domains: [
      {
        id: 'dom-001',
        domain: 'app.acme.com',
        project: 'acme-web',
        app: 'frontend',
        environment: 'production',
        status: 'active',
        cname_target: 'acme-web.theo.app',
        created_at: '2026-04-10T12:00:00Z',
        verified_at: '2026-04-10T12:08:00Z',
        tls: { status: 'issued', expires_at: '2026-07-10T12:08:00Z' },
      },
      {
        id: 'dom-002',
        domain: 'api.acme.com',
        project: 'acme-payments',
        app: 'stripe-webhook',
        environment: 'production',
        status: 'active',
        cname_target: 'acme-payments.theo.app',
        created_at: '2026-04-15T09:30:00Z',
        verified_at: '2026-04-15T09:42:00Z',
        tls: { status: 'issued', expires_at: '2026-07-15T09:42:00Z' },
      },
      {
        id: 'dom-003',
        domain: 'staging.acme.com',
        project: 'acme-marketing',
        app: 'landing',
        environment: 'staging',
        status: 'pending_verification',
        cname_target: 'acme-marketing.theo.app',
        created_at: '2026-05-23T14:00:00Z',
        verification: {
          txt_name: '_theo.staging.acme.com',
          txt_value: 'verify=a1b2c3d4e5f6g7h8',
        },
      },
      {
        id: 'dom-004',
        domain: 'preview.acme.com',
        project: 'acme-experiments',
        app: 'a-b-test',
        environment: 'preview',
        status: 'provisioning',
        cname_target: 'acme-experiments.theo.app',
        created_at: '2026-05-25T07:30:00Z',
      },
    ],
  },

  // -- /engine/api/v1/environments (EnvsResponse from pages/environments.tsx)
  '/engine/api/v1/environments': {
    environments: [
      { name: 'production', status: 'live', projects: 4, protected: true, domain: 'app.acme.com' },
      { name: 'staging', status: 'building', projects: 3, protected: false, domain: 'staging.acme.com' },
      { name: 'preview', status: 'live', projects: 5, protected: false, domain: '*.preview.acme.com' },
      { name: 'pr-1247', status: 'live', projects: 1, protected: false, domain: 'pr-1247.preview.acme.com' },
      { name: 'pr-1251', status: 'idle', projects: 1, protected: false, domain: 'pr-1251.preview.acme.com' },
      { name: 'load-test', status: 'failed', projects: 1, protected: false, domain: 'lt.acme.com' },
    ],
  },

  // -- /engine/api/v1/teams/members (TeamResponse from pages/team.tsx) -----
  '/engine/api/v1/teams/members': {
    members: [
      { username: 'paulo', name: 'Paulo Henrique', email: 'paulo@example.com', role: 'owner', joined: '2026-01-15' },
      { username: 'alice', name: 'Alice Costa', email: 'alice@acme.com', role: 'admin', joined: '2026-02-03' },
      { username: 'bob', name: 'Bob Tanaka', email: 'bob@acme.com', role: 'admin', joined: '2026-02-18' },
      { username: 'carlos', name: 'Carlos Mendes', email: 'carlos@acme.com', role: 'member', joined: '2026-03-12' },
      { username: 'dana', name: 'Dana Singh', email: 'dana@acme.com', role: 'member', joined: '2026-04-01' },
      { username: 'eve', name: 'Eve Johansson', email: 'eve@acme.com', role: 'member', joined: '2026-04-22' },
    ],
  },
};

/**
 * Lookup a mock response for a given path. Returns `undefined` for unknown
 * paths so the caller can fall through to the real fetch (or null).
 *
 * Wrapped as Promise<T | null> in cloudFetch's guard so the call signature
 * matches production behavior.
 */
export function getMockResponse<T>(path: string): T | null {
  const fixture = FIXTURES[path];
  if (fixture === undefined) {
    // Path not seeded — log once for diagnostic, return null (production behavior)
    if (typeof console !== 'undefined') {
      console.warn(`[dev-mocks] No fixture for path: ${path}`);
    }
    return null;
  }
  // Structured clone so mutations in components don't poison the fixture
  return JSON.parse(JSON.stringify(fixture)) as T;
}

// ============================================================================
// Kratos flow fixtures (T-B.2, EC-1, EC-7)
// ============================================================================
//
// Auth pages (login, register, recovery, verification) hit Kratos self-service
// endpoints via raw fetch. To enable visual validation of those 4 surfaces,
// install a `fetch` interceptor that matches `/self-service/*` paths and
// returns canned flow JSON without ever hitting the network.
//
// EC-1 (MUST FIX): submit responses MUST NEVER include `redirect_browser_to`
// — that would cause the page handler to mutate `window.location.href` and
// break the dev tour. Mock submit responses are flow-shaped objects only.
//
// EC-7: recovery flow has 2 phases (email → code). Verification flow needs
// `state: 'passed_challenge'` after submit for success render. Both encoded
// in MOCK_FLOWS below + the submit-response logic.

/**
 * Mock flow fixtures — one per Kratos self-service flow type. Each matches
 * the Flow interface in lib/kratos.ts so consumers receive a structurally
 * valid object.
 */
const MOCK_FLOWS: Record<string, unknown> = {
  login: {
    id: 'mock-login-flow',
    type: 'browser',
    ui: {
      action: '#mock-submit-login',
      method: 'POST',
      nodes: [
        { type: 'input', group: 'default', attributes: { name: 'csrf_token', type: 'hidden', value: 'mock-csrf' }, messages: [], meta: {} },
        { type: 'input', group: 'password', attributes: { name: 'identifier', type: 'email', required: true }, messages: [], meta: { label: { text: 'Email' } } },
        { type: 'input', group: 'password', attributes: { name: 'password', type: 'password', required: true }, messages: [], meta: { label: { text: 'Password' } } },
      ],
      messages: [],
    },
  },
  registration: {
    id: 'mock-registration-flow',
    type: 'browser',
    ui: {
      action: '#mock-submit-registration',
      method: 'POST',
      nodes: [
        { type: 'input', group: 'default', attributes: { name: 'csrf_token', type: 'hidden', value: 'mock-csrf' }, messages: [], meta: {} },
        { type: 'input', group: 'password', attributes: { name: 'traits.email', type: 'email', required: true }, messages: [], meta: { label: { text: 'Email' } } },
        { type: 'input', group: 'password', attributes: { name: 'traits.name', type: 'text' }, messages: [], meta: { label: { text: 'Name' } } },
        { type: 'input', group: 'password', attributes: { name: 'password', type: 'password', required: true }, messages: [], meta: { label: { text: 'Password' } } },
      ],
      messages: [],
    },
  },
  recovery: {
    // EC-7 phase 1: email input
    id: 'mock-recovery-flow',
    type: 'browser',
    state: 'choose_method',
    ui: {
      action: '#mock-submit-recovery',
      method: 'POST',
      nodes: [
        { type: 'input', group: 'default', attributes: { name: 'csrf_token', type: 'hidden', value: 'mock-csrf' }, messages: [], meta: {} },
        { type: 'input', group: 'code', attributes: { name: 'email', type: 'email', required: true }, messages: [], meta: { label: { text: 'Email' } } },
      ],
      messages: [],
    },
  },
  verification: {
    id: 'mock-verification-flow',
    type: 'browser',
    state: 'choose_method',
    ui: {
      action: '#mock-submit-verification',
      method: 'POST',
      nodes: [
        { type: 'input', group: 'default', attributes: { name: 'csrf_token', type: 'hidden', value: 'mock-csrf' }, messages: [], meta: {} },
        { type: 'input', group: 'code', attributes: { name: 'code', type: 'text', required: true }, messages: [], meta: { label: { text: 'Verification code' } } },
      ],
      messages: [],
    },
  },
};

/**
 * Phase-transitioned recovery flow (EC-7) — after the user submits the email
 * (phase 1), the flow advances to `state: 'sent_email'` with a `code` input
 * that the user must type. After code submit, state advances to
 * `passed_challenge` (success).
 */
const MOCK_RECOVERY_CODE_PHASE = {
  id: 'mock-recovery-flow',
  type: 'browser',
  state: 'sent_email',
  ui: {
    action: '#mock-submit-recovery',
    method: 'POST',
    nodes: [
      { type: 'input', group: 'default', attributes: { name: 'csrf_token', type: 'hidden', value: 'mock-csrf' }, messages: [], meta: {} },
      { type: 'input', group: 'code', attributes: { name: 'code', type: 'text', required: true }, messages: [], meta: { label: { text: 'Recovery code' } } },
    ],
    messages: [{ id: 1060001, text: 'An email containing a recovery code has been sent.', type: 'info' }],
  },
};

/**
 * Install a fetch interceptor when running with VITE_USE_MOCKS=true.
 * Intercepts only `/self-service/*` paths; all other fetches fall through.
 *
 * Called once at module-import time via the side-effect `installKratosMocks()`
 * call below; idempotent re-install is safe.
 *
 * EC-1 invariant: response payloads NEVER include `redirect_browser_to`,
 * preventing the page handler from mutating `window.location.href`.
 */
let originalFetch: typeof fetch | null = null;

/**
 * Dev-only per-page runtime error injection for a mocked auth flow. When an
 * auth-page e2e sets `window.__LOOPSCALE_MOCK_FLOW_ERROR = "message"` (via
 * page.addInitScript before app load), the GET-flow mock for that flow type
 * carries a `ui.messages` error — so the page's error-render path (e.g. the
 * login "We couldn't sign you in." Alert) is exercised end-to-end in the
 * browser. Without this hook the dev-mocks fetch wrapper intercepts every
 * /self-service/ request at the JS layer, so Playwright page.route() can never
 * reach the flow endpoint to inject an error. Returns the body unchanged when
 * no flag is set or the body has no `ui`. (M0 J-01 e2e harness fix.)
 */
function injectRuntimeFlowError(flowType: string, body: unknown): unknown {
  if (typeof window === 'undefined') return body;
  const msg = (window as unknown as { __LOOPSCALE_MOCK_FLOW_ERROR?: string }).__LOOPSCALE_MOCK_FLOW_ERROR;
  if (!msg || flowType !== 'login') return body;
  const flow = body as { ui?: { messages?: unknown[] } } | null;
  if (!flow?.ui) return body;
  return {
    ...flow,
    ui: { ...flow.ui, messages: [{ id: 4000006, type: 'error', text: msg }] },
  };
}

export function installKratosMocks(): void {
  if (!mocksEnabled()) return;
  if (typeof window === 'undefined') return;          // not in browser
  if (originalFetch !== null) return;                  // already installed
  originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    // Pass through anything that's not a Kratos self-service path
    if (!url.includes('/self-service/')) {
      return originalFetch!(input, init);
    }

    // Match the flow type from the URL: /self-service/{type}/browser or .../flows
    const match = url.match(/\/self-service\/([a-z]+)\//);
    const flowType = match?.[1] ?? '';

    let body: unknown;

    if (url.includes('/browser') || url.includes('/flows?id=')) {
      // GET flow init or load by ID
      body = MOCK_FLOWS[flowType] ?? null;
      body = injectRuntimeFlowError(flowType, body);
    } else {
      // POST submit — EC-1: NEVER include redirect_browser_to
      // EC-7: recovery phase transition (email → code → passed_challenge)
      body = computeMockSubmitResponse(flowType, init?.body);
    }

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

/**
 * Compute the mock response to a POST submit. EC-1 guarantee: NEVER returns
 * `redirect_browser_to`. EC-7 guarantee: recovery transitions email→code,
 * verification transitions to `passed_challenge`.
 */
function computeMockSubmitResponse(flowType: string, requestBody: unknown): unknown {
  // Parse the request body if provided (JSON string)
  let parsedBody: Record<string, unknown> = {};
  if (typeof requestBody === 'string') {
    try { parsedBody = JSON.parse(requestBody); } catch { /* ignore */ }
  }

  switch (flowType) {
    case 'recovery':
      // EC-7: phase 1 (email submit) → advance to code phase
      // phase 2 (code submit) → passed_challenge
      if ('email' in parsedBody) {
        return MOCK_RECOVERY_CODE_PHASE;
      }
      if ('code' in parsedBody) {
        return { state: 'passed_challenge', ui: { messages: [], nodes: [] } };
      }
      return MOCK_FLOWS.recovery;

    case 'verification':
      // EC-7: any submit → passed_challenge state (success)
      return {
        ...(MOCK_FLOWS.verification as object),
        state: 'passed_challenge',
      };

    case 'login':
    case 'registration':
      // Generic acknowledgment — no session, no redirect, no errors.
      // EC-1: explicitly omit redirect_browser_to + session fields so the
      // page handler stays on the current route without mutation.
      return MOCK_FLOWS[flowType];

    default:
      return null;
  }
}
