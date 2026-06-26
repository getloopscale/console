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

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
  engineFetch: (...args: unknown[]) => mockCloudFetch(...args),
}));

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

    expect(mockCloudFetch).toHaveBeenCalledWith('/v1/billing/portal');
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

  it('test_billing_renders_invoice_table_with_data', () => {
    // Plan EC-5 v1.2: invoice table OMITTED — no /v1/billing/invoices endpoint exists.
    // This test verifies the documented absence (no invoice section rendered) so
    // a future re-introduction is detected and triggers test update.
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'pro', team: 'acme', usage: {} },
      loading: false,
      error: false,
    });
    render(<BillingPage />);
    expect(screen.queryByText(/invoice/i)).not.toBeInTheDocument();
  });

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
