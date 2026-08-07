import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({
    active: true,
    identity: { id: 'test', traits: { email: 'u@x.com' } },
  }),
}));

const mockUseCloudApi = vi.fn();
vi.mock('@/hooks/use-api', () => ({
  // Sprint 3 Phase 3 (#21) — mock forwards (path, options) so the v1.1 route
  // gate (`{ enabled }`) can be observed by the new regression test below.
  useCloudApi: (path: string, options?: { enabled?: boolean }) => mockUseCloudApi(path, options),
  useEngineApi: (path: string, options?: { enabled?: boolean }) => mockUseCloudApi(path, options),
}));

// J-13: the page embeds <InvoicesCard/>, which fetches invoices via its own
// useInvoices hook. Mock it to a neutral empty state so the page tests don't
// exercise (or pollute the shared cloudFetch mock with) the invoices fetch —
// the invoice table has its own tests (components/billing/invoices-card.test.tsx).
vi.mock('@/hooks/use-invoices', () => ({
  useInvoices: () => ({ invoices: [], loading: false, forbidden: false, error: false }),
}));

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => {
  // Declare ApiError inside the factory closure — vi.mock hoists, so a top-
  // level class would be in the TDZ when the mock executes (vitest error
  // "Cannot access 'ApiError' before initialization").
  class ApiError extends Error {
    readonly status: number;
    readonly body?: unknown;
    constructor(status: number, body?: unknown, message?: string) {
      super(message ?? `API request failed with status ${status}`);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  }
  return {
    cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
    engineFetch: (...args: unknown[]) => mockCloudFetch(...args),
    ApiError,
  };
});

// Import the same mocked ApiError so the test's instanceof checks line up with
// the real module's export (the production catch branch checks instanceof).
import { ApiError } from '@/lib/api';

import { BillingPage } from './billing';

describe('BillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_billing_renders_plan_badge_with_current_plan', () => {
    mockUseCloudApi.mockReturnValue({
      data: {
        plan: 'pro',
        team: 'acme',
        usage: {},
      },
      loading: false,
      error: false,
    });
    render(<BillingPage />);
    // PlanBadge + plan label both render "Pro" — assert occurrence count.
    expect(screen.getAllByText('Pro').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('acme')).toBeInTheDocument();
  });

  // qa-sprint2-cleanup-2026-06-24 T2.1 — closes theo-cloud#15
  // (BLOCKER ux_friction: Manage Plan click was inert).
  //
  // Pre-fix: handler called window.open(portal.url, '_blank') from an async
  // callback after `await cloudFetch`. Modern browsers (Chrome 119+, Safari 17+,
  // Firefox 122+) BLOCK popups opened from async callbacks because the user
  // gesture activation expires. The popup was silently suppressed.
  //
  // T2.2 fix: swap window.open → window.location.href, matching the existing
  // upgradePlan handler (which uses window.location.href correctly) and Stripe's
  // documented canonical Customer Portal pattern (same-window navigation).
  it('test_billing_portal_button_navigates_same_window_on_success', async () => {
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'pro', team: 'acme', usage: {} },
      loading: false,
      error: false,
    });
    mockCloudFetch.mockResolvedValue({ url: 'https://billing.stripe.com/portal/xyz' });

    // jsdom does not implement navigation; stub the location.href setter so we
    // can observe what the click handler attempted to assign.
    const hrefSetter = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: {
        ...originalLocation,
        set href(v: string) { hrefSetter(v); },
        get href() { return originalLocation.href; },
      },
    });

    // EC-11 defense: window.open MUST NOT be called post-fix (would mean the
    // async-callback popup-blocker bug is back).
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    const user = userEvent.setup();
    render(<BillingPage />);
    await user.click(screen.getByRole('button', { name: /manage plan/i }));

    // The Manage Plan handler also forwards `{ throwOnError: true }` per
    // theo-cloud#49/#69 closure so non-2xx no longer falls into the
    // silent null branch; match the path argument loosely.
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/billing/portal',
      undefined,
      expect.objectContaining({ throwOnError: true }),
    );
    expect(hrefSetter).toHaveBeenCalledWith('https://billing.stripe.com/portal/xyz');
    expect(openSpy).not.toHaveBeenCalled();

    openSpy.mockRestore();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('test_billing_portal_button_renders_alert_on_null_response', async () => {
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'pro', team: 'acme', usage: {} },
      loading: false,
      error: false,
    });
    // Failure path: backend returns null OR a response with no `url` field.
    mockCloudFetch.mockResolvedValue(null);

    const user = userEvent.setup();
    render(<BillingPage />);
    await user.click(screen.getByRole('button', { name: /manage plan/i }));

    // Assert a destructive Alert renders with the failure copy — proves the
    // click produces an OBSERVABLE effect even on the failure path (the
    // canonical FAANG anti-inert assertion that closes the #15 BLOCKER).
    const alert = await screen.findByRole('alert');
    expect(alert.textContent ?? '').toMatch(/failed to open billing portal/i);
  });

  // EC-5 "invoice table OMITTED" test removed at J-13 (MEET-2026-07-03-004):
  // the invoice table now ships as a separate <InvoicesCard/> with its own
  // owner-gated fetch and its own tests (components/billing/invoices-card.test.tsx).

  it('test_billing_cancel_subscription_requires_confirmation', () => {
    // BillingPage v1.2: cancel flow is delegated to Stripe Portal (no in-app cancel button).
    // Verify there is no direct cancel button — managing plan goes through portal.
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'pro', team: 'acme', usage: {} },
      loading: false,
      error: false,
    });
    render(<BillingPage />);
    expect(screen.queryByRole('button', { name: /cancel subscription/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manage plan/i })).toBeInTheDocument();
  });

  it('test_billing_usage_meter_reflects_period_data', () => {
    mockUseCloudApi.mockReturnValue({
      data: {
        plan: 'pro',
        team: 'acme',
        usage: {
          build_minutes: { used: 120, limit: 500 },
          bandwidth_mb: { used: 1000, limit: 10000 },
        },
        period_start: '2026-05-01T00:00:00Z',
        period_end: '2026-05-31T23:59:59Z',
      },
      loading: false,
      error: false,
    });
    render(<BillingPage />);
    expect(screen.getByText('Usage This Period')).toBeInTheDocument();
    // T-DR-1.3 v1.2: metric labels now appear in BOTH places (Plan card
    // quota Includes section + UsageMeter). Use getAllByText for ambiguity.
    expect(screen.getAllByText('Build Minutes').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Bandwidth Mb').length).toBeGreaterThanOrEqual(1);
  });

  it('test_billing_plan_card_renders_quota_summary_v12', () => {
    // T-DR-1.3 v1.2 (closes P2-1): Plan card now shows "Includes" quota
    // summary inline (drawn from billing.usage map).
    mockUseCloudApi.mockReturnValue({
      data: {
        plan: 'pro',
        team: 'acme',
        usage: {
          build_minutes: { used: 120, limit: 500 },
          bandwidth_mb: { used: 1000, limit: 10000 },
        },
      },
      loading: false,
      error: false,
    });
    render(<BillingPage />);
    expect(screen.getByText('Includes')).toBeInTheDocument();
  });

  it('test_billing_upsell_is_focusable_button_with_accessible_name_closes_27', () => {
    // Sprint 3 Phase 7 (#27) v1.1 ADR D4 — upsell card was a <Card onClick>
    // with <p> content (not focusable, no role). Now a real <button> wrapping
    // <Card.Body>. v1.1 EC-3: dropped <Card as="button"> polymorphic gamble
    // (the @usetheo/ui Card .d.ts has no `as`/`asChild` prop).
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'starter', team: 'acme', usage: {} },
      loading: false,
      error: false,
    });
    render(<BillingPage />);
    const upgradeBtn = screen.getByRole('button', { name: /upgrade to pro/i });
    expect(upgradeBtn).toBeInTheDocument();
    expect(upgradeBtn.tagName).toBe('BUTTON');
    // Focusable + keyboard activation contract (Enter AND Space both fire
    // `click` natively on <button>; jsdom doesn't dispatch synthesized key
    // → click bridging, so we lock the structural invariant instead).
    expect(upgradeBtn.getAttribute('type')).toBe('button');
    expect(upgradeBtn.className).toMatch(/focus-visible:ring/);
  });

  // theo-cloud#63 (BLOCKER functional_bug): POST /v1/billing/checkout {plan:'pro'}
  // returns 503 + actionable body `{"code":"BILLING_NOT_CONFIGURED","message":
  // "Plan 'pro' is not available for purchase yet. Please contact support."}` per
  // release-blockers-2026-06-25-set T4.2 backend fix. Pre-fix the UI catch block
  // showed the generic toast "Failed to start checkout. Please try again." which
  // (a) discarded the server's actionable message and (b) suggested retry for a
  // non-transitory condition (every retry → 503 again, user stuck). Fix opts the
  // billing checkout mutation into cloudFetch `{ throwOnError: true }` so the
  // ApiError surfaces with the server's body, and the catch block reads
  // `error.body.message` for actionable copy (KISS: no new UI invented).
  it('test_billing_upgrade_surfaces_server_actionable_message_when_503_BILLING_NOT_CONFIGURED_closes_63', async () => {
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'starter', team: 'acme', usage: {} },
      loading: false,
      error: false,
    });
    // Backend canonical 503 shape per Sprint 4 release-blockers fix.
    mockCloudFetch.mockRejectedValue(new ApiError(503, {
      code: 'BILLING_NOT_CONFIGURED',
      message: "Plan 'pro' is not available for purchase yet. Please contact support.",
    }));

    const user = userEvent.setup();
    render(<BillingPage />);
    await user.click(screen.getByRole('button', { name: /upgrade to pro/i }));

    // UI surfaces the SERVER's actionable message.
    const alert = await screen.findByRole('alert');
    const text = alert.textContent ?? '';
    expect(text).toMatch(/Plan 'pro' is not available for purchase yet/);
    expect(text).toMatch(/contact support/i);

    // Anti-regression: the misleading "Please try again" copy MUST NOT appear
    // for a non-transitory 503 (Sprint 4 #39 distinguished the 4xx user-input
    // class from the 5xx operator-action class; #63 closes the UI parity).
    expect(text).not.toMatch(/please try again/i);
  });

  // Red Team theo-cloud#72 closure: a double-tap on the Upgrade button
  // used to fire two POST /v1/billing/checkout requests in a row. The
  // disabled={actionLoading} guard ensures the first click locks the
  // button until the promise resolves.
  it('upgrade button is disabled while the checkout request is in flight (#72)', async () => {
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'free', team: 'acme', usage: {}, period_end: '2026-12-31' },
      loading: false,
      error: false,
    });
    // Resolve only after we observe the button getting disabled. A never-
    // resolving promise would leave the test hanging on the timeout.
    let releaseFetch!: (v: { url: string }) => void;
    mockCloudFetch.mockReturnValue(
      new Promise<{ url: string }>((resolve) => {
        releaseFetch = resolve;
      }),
    );

    const user = userEvent.setup();
    render(<BillingPage />);
    const button = screen.getByRole('button', { name: /upgrade to pro/i });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(button).toBeDisabled();
    // Cleanup so the test exits cleanly.
    releaseFetch({ url: 'https://checkout.stripe.com/x' });
  });

  // Red Team theo-cloud#72 re-open: React 18 batches setActionLoading until
  // the click handler returns, so disabled={actionLoading} alone does NOT
  // block a SYNCHRONOUS double-click. Two clicks fired before the next
  // render both see disabled=false and both POST. A ref guard short-circuits
  // the 2nd click synchronously; this test fires both clicks before the
  // promise resolves and asserts cloudFetch was called exactly once.
  it('synchronous double-click on Upgrade fires the request only once (#72 re-open)', async () => {
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'free', team: 'acme', usage: {}, period_end: '2026-12-31' },
      loading: false,
      error: false,
    });
    let releaseFetch!: (v: { url: string }) => void;
    mockCloudFetch.mockReturnValue(
      new Promise<{ url: string }>((resolve) => {
        releaseFetch = resolve;
      }),
    );
    render(<BillingPage />);
    const button = screen.getByRole('button', { name: /upgrade to pro/i }) as HTMLButtonElement;
    // Two synchronous clicks before React can re-render — the ref guard
    // is the only thing that can prevent both from firing.
    button.click();
    button.click();
    expect(mockCloudFetch).toHaveBeenCalledTimes(1);
    releaseFetch({ url: 'https://checkout.stripe.com/x' });
  });

  // Red Team theo-cloud#40 closure: when the backend returns a 4xx with
  // no actionable body, the prior copy was "Please try again." — which
  // misleads the user into hammering a permanently non-retryable
  // endpoint. The new copy points to support.
  // Red Team theo-cloud#49/#69 closure: a Free-tier visitor clicking
  // Manage Plan used to see no feedback — the cloudFetch silent-null
  // path swallowed the 4xx. Opt-in to throwOnError + surface the
  // canonical "contact support" message so the button is no longer a
  // dead-end.
  it('Manage Plan surfaces a contact-support alert on 4xx (#49/#69)', async () => {
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'pro', team: 'acme', usage: {}, period_end: '2026-12-31' },
      loading: false,
      error: false,
    });
    mockCloudFetch.mockRejectedValueOnce(new ApiError(400, {}));
    const user = userEvent.setup();
    render(<BillingPage />);
    const button = screen.getByRole('button', { name: /manage plan/i });
    await user.click(button);
    const alert = await screen.findByRole('alert');
    const text = alert.textContent ?? '';
    expect(text.toLowerCase()).toContain('contact support');
  });

  it('4xx without body surfaces "contact support" copy, NOT "try again" (#40)', async () => {
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'free', team: 'acme', usage: {}, period_end: '2026-12-31' },
      loading: false,
      error: false,
    });
    mockCloudFetch.mockRejectedValueOnce(new ApiError(400, {}));
    const user = userEvent.setup();
    render(<BillingPage />);
    const button = screen.getByRole('button', { name: /upgrade to pro/i });
    await user.click(button);
    const alert = await screen.findByRole('alert');
    const text = alert.textContent ?? '';
    expect(text.toLowerCase()).toContain('contact support');
    expect(text.toLowerCase()).not.toContain('please try again');
  });

  it('test_billing_memory_metrics_query_disabled_on_non_memory_route_closes_21', () => {
    // Sprint 3 Phase 3 (#21) v1.1 ADR D2 — MemoryUsageCard on /billing must
    // pass `{ enabled: false }` to useCloudApi for `/v1/dashboard/memory/metrics`
    // (because pathname.startsWith('/memory') is false on /billing). This
    // prevents the noisy 404 console spam reported by QA against dev-public.
    mockUseCloudApi.mockReturnValue({ data: null, loading: false, error: false });
    render(<BillingPage />);
    // The MemoryUsageCard call site MUST appear in the mock log with enabled=false.
    const memoryCalls = mockUseCloudApi.mock.calls.filter(
      (args) => args[0] === '/v1/dashboard/memory/metrics',
    );
    expect(memoryCalls.length).toBeGreaterThan(0);
    // Every memory-metrics call from /billing route must have enabled=false.
    for (const call of memoryCalls) {
      expect(call[1]?.enabled).toBe(false);
    }
  });
});
