import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensMonitorsPage } from './monitors';

describe('LensMonitorsPage (/observability/monitors)', () => {
  beforeEach(() => vi.clearAllMocks());

  // #179 — pick the evaluator from a <Select> (fed by GET /evaluators), not a free-text id.
  function withEvaluators(evaluators = [{ id: 'ev_1', name: 'Answer relevance' }]) {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url === '/v1/dashboard/lens/evaluators') return Promise.resolve({ evaluators });
      return Promise.resolve({ monitors: [] });
    });
  }

  // M77 — a guard whose breaches can be inspected. Wires evaluators + one guard + a breaches read.
  function withGuardAndBreaches(traceIds: string[]) {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url === '/v1/dashboard/lens/evaluators') return Promise.resolve({ evaluators: [{ id: 'ev_1', name: 'Answer relevance' }] });
      if (/\/monitors\/gd_1\/breaches$/.test(url)) return Promise.resolve({ traceIds });
      if (url === '/v1/dashboard/lens/monitors') return Promise.resolve({ monitors: [{ id: 'gd_1', evaluatorId: 'ev_1', operator: 'gte', threshold: 0.8 }] });
      return Promise.resolve({});
    });
  }

  it('M77 — View breaches lists the breaching traces, each deep-linking to its trace peek', async () => {
    withGuardAndBreaches(['tr-a', 'tr-b']);
    render(<LensMonitorsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /view breaches/i }));
    // the breaches read fires for this guard
    expect(mockCloudFetch.mock.calls.some((c) => /\/monitors\/gd_1\/breaches$/.test(String(c[0])))).toBe(true);
    // each breaching trace is a link to its ?trace= peek (M76)
    const a = await screen.findByRole('link', { name: /tr-a/i });
    expect(a).toHaveAttribute('href', '/observability/traces?trace=tr-a');
    expect(screen.getByRole('link', { name: /tr-b/i })).toHaveAttribute('href', '/observability/traces?trace=tr-b');
  });

  it('M77 — the breaches panel shows the monitor rule and an honest empty state', async () => {
    withGuardAndBreaches([]); // no trace has failed this guard
    render(<LensMonitorsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /view breaches/i }));
    // the guard rule is shown as context (evaluator name + operator symbol + threshold) in the description
    expect(await screen.findByText(/Traces failing Answer relevance ≥ 0\.8/)).toBeInTheDocument();
    // honest empty state — no fabricated breach
    expect(screen.getByText(/no trace has breached this monitor/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open trace/i })).not.toBeInTheDocument();
  });

  it('M77 — a failed breaches read fails closed to a typed Alert (never a silent empty state)', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url === '/v1/dashboard/lens/evaluators') return Promise.resolve({ evaluators: [{ id: 'ev_1', name: 'Answer relevance' }] });
      if (/\/monitors\/gd_1\/breaches$/.test(url)) return Promise.resolve().then(() => { throw Object.assign(new Error('down'), { status: 502 }); });
      if (url === '/v1/dashboard/lens/monitors') return Promise.resolve({ monitors: [{ id: 'gd_1', evaluatorId: 'ev_1', operator: 'gte', threshold: 0.8 }] });
      return Promise.resolve({});
    });
    render(<LensMonitorsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /view breaches/i }));
    expect(await screen.findByTestId('breaches-error')).toBeInTheDocument();
    // fail-closed: the empty-state text must NOT show (a failure is not "no breaches")
    expect(screen.queryByText(/no trace has breached this monitor/i)).not.toBeInTheDocument();
  });

  it('creates a monitor by SELECTING an evaluator + operator (no free-text id) — #179', async () => {
    withEvaluators();
    render(<LensMonitorsPage />);
    await screen.findByText(/no monitors yet/i);

    // the create form lives in a centered modal (AppModal) — open it via the primary action first
    await userEvent.click(screen.getByRole('button', { name: /new monitor/i }));

    // the evaluator is a Select fed by GET /evaluators, labelled by name (not a free-text id box)
    await userEvent.click(await screen.findByRole('combobox', { name: /evaluator/i }));
    await userEvent.click(await screen.findByRole('option', { name: /answer relevance/i }));
    await userEvent.type(screen.getByLabelText(/threshold/i), '0.8');
    await userEvent.click(screen.getByRole('button', { name: /create guard/i }));

    const call = mockCloudFetch.mock.calls.find(
      (c) => c[0] === '/v1/dashboard/lens/monitors' && (c[1] as { method?: string })?.method === 'POST',
    );
    expect(call).toBeTruthy();
    const body = JSON.parse((call![1] as { body: string }).body);
    expect(body.evaluatorId).toBe('ev_1'); // the SELECTED id (value), surfaced by name
    expect(body.operator).toBe('gte');
    expect(body.threshold).toBe(0.8);
  });

  it('hides the threshold and omits it for a label_eq monitor — #179', async () => {
    withEvaluators();
    render(<LensMonitorsPage />);
    await screen.findByText(/no monitors yet/i);
    await userEvent.click(screen.getByRole('button', { name: /new monitor/i }));
    await userEvent.click(await screen.findByRole('combobox', { name: /evaluator/i }));
    await userEvent.click(await screen.findByRole('option', { name: /answer relevance/i }));
    // pick the label_eq operator → the threshold field disappears
    await userEvent.click(screen.getByRole('combobox', { name: /operator/i }));
    await userEvent.click(await screen.findByRole('option', { name: /matches label/i }));
    expect(screen.queryByLabelText(/threshold/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /create guard/i }));

    const call = mockCloudFetch.mock.calls.find(
      (c) => c[0] === '/v1/dashboard/lens/monitors' && (c[1] as { method?: string })?.method === 'POST',
    );
    const body = JSON.parse((call![1] as { body: string }).body);
    expect(body.operator).toBe('label_eq');
    expect(body.threshold).toBeUndefined(); // no fabricated threshold for a label match
  });

  it('M73 — the empty state has a CTA that opens the create modal (one clear action)', async () => {
    mockCloudFetch.mockResolvedValue({ guards: [] });
    render(<LensMonitorsPage />);
    await screen.findByText(/no monitors yet/i);
    await userEvent.click(screen.getByRole('button', { name: /create your first monitor/i }));
    // the CTA opens the centered create modal — its evaluator field is now available
    expect(await screen.findByRole('combobox', { name: /evaluator/i })).toBeInTheDocument();
  });

  it('renders empty state and delete flow via ConfirmDialog', async () => {
    mockCloudFetch.mockResolvedValue({ monitors: [{ id: 'gd_1', evaluatorId: 'ev_1', operator: 'gte', threshold: 0.8 }] });
    render(<LensMonitorsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /delete gd_1/i }));
    await userEvent.click(await screen.findByRole('button', { name: /delete guard/i }));
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/lens/monitors/gd_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

/**
 * M136 — the user-visible copy, asserted.
 *
 * The LIVE test found this milestone had renamed the file, the component, the route and the fetch
 * path while leaving every string a user actually reads saying "Guards" — including the subtitle
 * "Gate traces on evaluator thresholds", which is the exact over-promise the milestone exists to
 * remove. Every hermetic test passed, because none of them looked at copy.
 *
 * "Gate" and "guard" imply blocking. Theo Lens observes; your own application blocks.
 */
describe('M136 user-visible copy', () => {
  it('reads Monitors, never Guards, and never promises gating', async () => {
    mockCloudFetch.mockImplementation(() => Promise.resolve({ monitors: [] }));
    render(<LensMonitorsPage />);

    expect(await screen.findByText('Monitors')).toBeInTheDocument();
    // The words that promise enforcement must not appear anywhere the user can read.
    for (const forbidden of [/\bguard/i, /\bgate\b/i]) {
      expect(document.body.textContent ?? '').not.toMatch(forbidden);
    }
  });
});

/**
 * M136 — a bookmarked /observability/guards must not 404.
 *
 * The LIVE test caught this: the route was renamed with no alias at all, so anyone holding a
 * bookmark landed on "Page not found". The milestone's own risk register lists "breaking external
 * consumers" first, and a bookmarked URL is a consumer.
 *
 * A redirect is right HERE and wrong for the API: a browser follows one natively, while an HTTP
 * client may not — which is why the API alias mounts the same handler instead.
 */
describe('M136 deprecated UI route', () => {
  it('declares a redirect for /observability/guards instead of leaving it to the 404 catch-all', async () => {
    // Deliberately a SOURCE assertion, not a render: mounting <App/> nests a second Router.
    // It proves the route is DECLARED; that it actually redirects was verified in a real browser
    // against dev-public, which is how the missing alias was found in the first place.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/app.tsx'), 'utf8');
    // Match the ROUTE line, not the comment above it — the first draft of this assertion picked
    // the comment and failed against correct code, which is the same wrong-thing-matched mistake
    // this milestone kept surfacing at larger scales.
    const line = src
      .split('\n')
      .find((l) => l.includes('<Route path="/observability/guards"'));
    expect(line, '/observability/guards must still be routed').toBeDefined();
    expect(line).toMatch(/Navigate to="\/observability\/monitors"/);
  });
});

/**
 * theo-cloud#259 — the M135 DoD that shipped open: the Monitors screen shows severity + last-evaluated.
 *
 * The state ALREADY exists — the evaluator writes `status` / `last_evaluated_at` / `stale` onto the
 * monitor-backed rule in `lens_alert_rules`, and `GET /v1/dashboard/lens/alert-rules` already returns
 * all three keyed by `monitor_id`. Nothing was persisted or exposed for this; the screen simply never
 * read it, so the scheduler held a severity no surface displayed.
 *
 * The tests below pin the distinctions that make the column honest. Collapsing any of them back into
 * a green "OK" is the exact failure the M135 risk register called "two sources of truth".
 */
describe('#259 — monitor severity + last-evaluated', () => {
  beforeEach(() => vi.clearAllMocks());

  /** One monitor (gd_1) plus whatever alert-rules the case wants to pair with it. */
  function withMonitorAndRules(alert_rules: unknown[], opts: { rulesFail?: boolean } = {}) {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url === '/v1/dashboard/lens/evaluators') return Promise.resolve({ evaluators: [{ id: 'ev_1', name: 'Answer relevance' }] });
      if (url === '/v1/dashboard/lens/monitors') return Promise.resolve({ monitors: [{ id: 'gd_1', evaluatorId: 'ev_1', operator: 'gte', threshold: 0.8 }] });
      if (String(url).startsWith('/v1/dashboard/lens/alert-rules')) {
        if (opts.rulesFail) return Promise.resolve().then(() => { throw Object.assign(new Error('down'), { status: 502 }); });
        return Promise.resolve({ alert_rules });
      }
      return Promise.resolve({});
    });
  }

  const rule = (over: Record<string, unknown> = {}) => ({
    id: 'lar-0000000000000001', name: 'r', metric: 'monitor_breach', comparator: 'gt', threshold: 0,
    window_seconds: 3600, webhook_id: 'wwh-1', monitor_id: 'gd_1', enabled: true, status: 'OK',
    stale: false, last_evaluated_at: '2026-07-28T20:00:00Z', last_triggered_at: null, ...over,
  });

  it('a cleared monitor-backed rule shows OK and its last-evaluated time', async () => {
    withMonitorAndRules([rule()]);
    render(<LensMonitorsPage />);
    expect(await screen.findByTestId('monitor-severity-gd_1')).toHaveTextContent(/ok/i);
    expect(screen.getByTestId('monitor-last-evaluated-gd_1')).not.toHaveTextContent('—');
  });

  it('a firing rule shows Alert — the severity the webhook already fired on', async () => {
    withMonitorAndRules([rule({ status: 'TRIGGERED', last_triggered_at: '2026-07-28T20:01:00Z' })]);
    render(<LensMonitorsPage />);
    expect(await screen.findByTestId('monitor-severity-gd_1')).toHaveTextContent(/triggered/i);
  });

  /**
   * The core of #259. A monitor with NO alert rule is not healthy — nothing evaluates it. Rendering
   * "OK" here would assert a measurement that never happened.
   */
  it('a monitor with no alert rule reads "Not monitored" — never OK', async () => {
    withMonitorAndRules([]); // no rule points at gd_1
    render(<LensMonitorsPage />);
    const cell = await screen.findByTestId('monitor-severity-gd_1');
    expect(cell).toHaveTextContent(/not monitored/i);
    expect(cell).not.toHaveTextContent(/\bok\b/i);
    // and there is no evaluation time to show
    expect(screen.getByTestId('monitor-last-evaluated-gd_1')).toHaveTextContent('—');
  });

  /**
   * A rule that stopped being evaluated is the failure the whole feature exists to catch: the tick
   * died, so no breach can ever fire. Showing the last known status alone would look healthy.
   */
  it('a stale rule is surfaced as Stale, not as its last known status', async () => {
    withMonitorAndRules([rule({ stale: true, status: 'OK' })]);
    render(<LensMonitorsPage />);
    expect(await screen.findByTestId('monitor-severity-gd_1')).toHaveTextContent(/stale/i);
  });

  it('a disabled rule reads Disabled — inert, not OK', async () => {
    withMonitorAndRules([rule({ enabled: false })]);
    render(<LensMonitorsPage />);
    const cell = await screen.findByTestId('monitor-severity-gd_1');
    expect(cell).toHaveTextContent(/disabled/i);
    expect(cell).not.toHaveTextContent(/\bok\b/i);
  });

  /**
   * Fail-closed (error-handling.md): a failed rules read must NOT degrade into "Not monitored" —
   * that would claim, from an outage, that the operator has no coverage.
   */
  it('a failed alert-rules read shows Unknown, never "Not monitored" or OK', async () => {
    withMonitorAndRules([], { rulesFail: true });
    render(<LensMonitorsPage />);
    const cell = await screen.findByTestId('monitor-severity-gd_1');
    expect(cell).toHaveTextContent(/unknown/i);
    expect(cell).not.toHaveTextContent(/not monitored/i);
    expect(cell).not.toHaveTextContent(/\bok\b/i);
  });
});

/**
 * #259 — the field names this screen reads are produced by Go, and nothing else connects the two.
 *
 * The React tests above mock `cloudFetch`, so they pin how the screen CONSUMES the payload;
 * `internal/routes/lens_alert_rules_test.go` pins what the route EMITS. Both can stay green while
 * drifting apart, and the drift is silent in the worst possible direction: rename `monitor_id` in Go
 * and every monitor renders "Not monitored" — the screen would assert, confidently, that the operator
 * has no coverage at all.
 *
 * A SOURCE assertion is the cheap guard, and it is a pattern this file already uses (the M136 route
 * alias test below reads app.tsx the same way) rather than new contract-test machinery nobody asked for.
 */
describe('#259 — the alert-rule contract the Monitors screen depends on', () => {
  it('lens_alert_rules.go still emits monitor_id, stale and last_evaluated_at', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    // dashboard/ → theo-cloud/
    const src = fs.readFileSync(path.resolve(process.cwd(), '../internal/routes/lens_alert_rules.go'), 'utf8');
    for (const tag of ['json:"monitor_id,omitempty"', 'json:"stale"', 'json:"last_evaluated_at"']) {
      expect(src, `${tag} is read by the Monitors screen — renaming it silently blanks the Status column`).toContain(tag);
    }
  });
});

/**
 * #259 regression — the defect the mocked tests above could NOT catch.
 *
 * `cloudFetch` defaults to `T | null` and does NOT throw; it only rejects when the call site opts in
 * with `{ throwOnError: true }`. The failure test above passes a mock that THROWS, which is the
 * behaviour of an opted-in call — so it stayed green against a query that had not opted in. Driving
 * the real stack exposed it: with the BFF returning 502, the query resolved `null`, reported SUCCESS,
 * and every monitor rendered "Not monitored" — asserting, from an outage, that nothing is watching.
 *
 * This test reproduces the REAL client contract (resolve null) instead of the opted-in one.
 */
describe('#259 — a null-resolving alert-rules read must not read as "Not monitored"', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolving null (cloudFetch default on failure) still shows Unknown', async () => {
    mockCloudFetch.mockImplementation((url: string, _init?: unknown, opts?: { throwOnError?: boolean }) => {
      if (url === '/v1/dashboard/lens/evaluators') return Promise.resolve({ evaluators: [] });
      if (url === '/v1/dashboard/lens/monitors') return Promise.resolve({ monitors: [{ id: 'gd_1', evaluatorId: 'ev_1', operator: 'gte', threshold: 0.8 }] });
      if (String(url).startsWith('/v1/dashboard/lens/alert-rules')) {
        // The real client: throws ONLY when the call site opted in; otherwise resolves null.
        if (opts?.throwOnError) return Promise.resolve().then(() => { throw Object.assign(new Error('down'), { status: 502 }); });
        return Promise.resolve(null);
      }
      return Promise.resolve({});
    });
    render(<LensMonitorsPage />);
    const cell = await screen.findByTestId('monitor-severity-gd_1');
    expect(cell, 'the page must opt into throwOnError, or a 502 reads as "no coverage"').toHaveTextContent(/unknown/i);
    expect(cell).not.toHaveTextContent(/not monitored/i);
  });
});
