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
