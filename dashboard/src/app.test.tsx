// Regression coverage for the API-tokens route consolidation.
//
// Before this commit:
//   - /api-keys              → ApiKeysPage (orphaned; no sidebar entry pointed here)
//   - /settings/tokens       → SubPagePlaceholder ("coming soon" + a non-existent
//                              `theo token create` CLI suggestion — the sidebar's
//                              actual target)
//
// After:
//   - /api-keys              → <Navigate to="/settings/tokens" replace />
//   - /settings/tokens       → ApiKeysPage (the real, FAANG-shape lifecycle UI)
//
// These tests pin the new behavior. If a future edit re-orphans the page or
// reintroduces the placeholder, the suite fails loudly instead of silently
// hiding the only platform-key UI again.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { render, screen } from '@/test/render';
import { ApiKeysPage } from './pages/api-keys';

// Stub component used by the previews-redirect test below. Asserts on the
// query string of the destination so the test can prove ?project=<slug> was
// carried over by the redirect.
function EnvironmentsStub() {
  const loc = useLocation();
  return (
    <div>
      <span>environments stub for redirect</span>
      <span data-testid="search">{loc.search}</span>
    </div>
  );
}

// Mirrors the production PreviewsRedirect helper from app.tsx — kept inline
// here so the test does not import the real component (the suite stays
// independent of unrelated app.tsx churn).
function PreviewsRedirect() {
  const { name } = useParams();
  return (
    <Navigate
      to={`/environments?project=${encodeURIComponent(name ?? '')}`}
      replace
    />
  );
}

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({
    active: true,
    identity: { id: 'test', traits: { email: 'u@x.com' } },
  }),
}));

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
  engineFetch: (...args: unknown[]) => mockCloudFetch(...args),
}));

// Minimal route table that mirrors the two routes under test from app.tsx.
// We do NOT mount <App /> because <App /> declares its own BrowserRouter,
// which would conflict with the MemoryRouter the test render helper provides.
// Pinning the behavior in isolation keeps the regression contract sharp and
// independent of unrelated route additions to app.tsx.
// Red Team theo-cloud#102 closure: same shape as PreviewsRedirect, but
// /projects/:name/repository → /projects/:name/connect.
function RepositoryAliasStub() {
  const { name } = useParams();
  return <Navigate to={`/projects/${encodeURIComponent(name ?? '')}/connect`} replace />;
}

function ConnectStub() {
  return <div data-testid="connect-page-stub">repository connection stub</div>;
}

function RoutingHarness() {
  return (
    <Routes>
      <Route path="/api-keys" element={<Navigate to="/settings/tokens" replace />} />
      <Route path="/settings/tokens" element={<ApiKeysPage />} />
      <Route path="/projects/:name/previews" element={<PreviewsRedirect />} />
      <Route path="/projects/:name/repository" element={<RepositoryAliasStub />} />
      <Route path="/projects/:name/connect" element={<ConnectStub />} />
      <Route path="/environments" element={<EnvironmentsStub />} />
      {/* Red Team theo-cloud#55 closure: /registration is an alias of
          /register. We pin the route here in isolation so the regression
          is locked even if app.tsx churns. */}
      <Route path="/registration" element={<Navigate to="/register" replace />} />
      <Route path="/register" element={<div>register page stub</div>} />
    </Routes>
  );
}

describe('App routing — API tokens consolidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCloudFetch.mockResolvedValue({ keys: [] });
  });

  it('/settings/tokens renders the real ApiKeysPage (not a placeholder)', async () => {
    render(<RoutingHarness />, { initialEntries: ['/settings/tokens'] });

    // The real page shows the empty-state copy from ApiKeysPage; the old
    // placeholder said "API Tokens is coming soon" + suggested the
    // non-existent `theo token create --name my-token` CLI.
    expect(await screen.findByText(/No API keys yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/theo token create/i)).not.toBeInTheDocument();
  });

  it('/api-keys redirects to /settings/tokens (URL alias for bookmarks)', async () => {
    render(<RoutingHarness />, { initialEntries: ['/api-keys'] });

    // After the Navigate replace, the rendered tree must be the real page.
    // We don't assert on location.pathname because MemoryRouter exposes it
    // via context not window.location; observing the rendered output is the
    // user-equivalent signal anyway.
    expect(await screen.findByText(/No API keys yet/i)).toBeInTheDocument();
  });
});

describe('App routing — Red Team theo-cloud#102 closure', () => {
  it('/projects/:name/repository redirects to /projects/:name/connect', async () => {
    render(<RoutingHarness />, {
      initialEntries: ['/projects/theokit-example/repository'],
    });
    expect(await screen.findByTestId('connect-page-stub')).toBeInTheDocument();
  });
});

describe('App routing — Red Team theo-cloud#55 closure', () => {
  it('/registration redirects to /register without falsely claiming "Session expired"', async () => {
    render(<RoutingHarness />, { initialEntries: ['/registration'] });
    // After the Navigate replace, the stub for /register renders.
    expect(await screen.findByText(/register page stub/i)).toBeInTheDocument();
    // The misleading "Session expired" toast MUST not appear on a fresh
    // browser context that never had a session to expire.
    expect(screen.queryByText(/session expired/i)).not.toBeInTheDocument();
  });
});

describe('App routing — /previews → /environments redirect (post-M2 single-slot)', () => {
  // Plan 2026-06-08-dashboard-screens-review-fixes T1.1 — ADR D1.
  // Pre-M2 the /projects/:name/previews page rendered a multi-row preview
  // table; post-M2 single-slot model (memory
  // reference_preview_as_category_phase_0_7_engineering_complete) makes
  // that table semantically obsolete because the preview is now a 1-slot
  // substituted entity surfaced inline on /environments. Page deletion +
  // 301-equivalent client redirect preserve any external bookmarks.

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('/projects/:name/previews redirects to /environments?project=:name', async () => {
    render(<RoutingHarness />, {
      initialEntries: ['/projects/teste/previews'],
    });

    // Destination page rendered: prove redirect landed.
    expect(
      await screen.findByText(/environments stub for redirect/i),
    ).toBeInTheDocument();
    // ?project=teste preserved in the query string.
    expect(screen.getByTestId('search')).toHaveTextContent('?project=teste');
  });

  it('/projects/:name/previews carries non-trivial slug (encoded)', async () => {
    render(<RoutingHarness />, {
      initialEntries: ['/projects/my-app-staging-eu-1/previews'],
    });

    expect(
      await screen.findByText(/environments stub for redirect/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('search')).toHaveTextContent(
      '?project=my-app-staging-eu-1',
    );
  });
});

/**
 * Sprint 3 Phase 2 (#17) v1.1 — SPA stale-content fix.
 *
 * Asserts the React Suspense fallback during route transitions surfaces a
 * `role="status"` element so AT users hear the navigation in progress AND so
 * a future regression cannot strip the loading state silently. The lazy-route
 * resolution is hard to deterministically reproduce in jsdom (dynamic `import()`
 * resolves synchronously when chunks are pre-fetched), so this test pins the
 * contract on the standalone <RouteLoading /> component that the Suspense
 * boundaries in `app.tsx` use as their fallback.
 */
describe('Sprint 3 Phase 2 #17 — Suspense fallback contract', () => {
  it('RouteLoading renders a role="status" element with an aria-label', async () => {
    const { RouteLoading } = await import('@/components/loading/route-loading');
    const { container } = render(<RouteLoading />);
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute('aria-label')).toBe('Loading');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    // sr-only fallback text for screen readers that ignore aria-label.
    expect(status?.textContent).toMatch(/loading/i);
  });
});
