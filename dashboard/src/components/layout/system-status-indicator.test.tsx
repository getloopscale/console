// M21 T3.1 — the footer indicator that replaces the hardcoded `● Operational`.
//
// Every assertion here exists because the literal it replaces could not fail: the
// text, the dot and the aria-label all came from JSX with no data behind them.
//
// Data reaches the component through `vi.mock('@/lib/http/api')` (repo precedent:
// `src/pages/memory/graph.test.tsx:20-23`); a global fetch stub cannot deliver it
// because `cloudFetch` gates on `ensureToken()` first (`src/lib/api.ts:184-188`).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/render';

const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({
  cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
  engineFetch: (...args: unknown[]) => mockCloudFetch(...args),
}));

import { SERVICE_VERSIONS_PATH } from '@/hooks/overview/use-service-versions';

import { SystemStatusIndicator } from './system-status-indicator';

const at = '2026-07-28T10:00:00Z';

function stubVersions(services: unknown[]) {
  mockCloudFetch.mockResolvedValue({ collected_at: at, services });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SystemStatusIndicator', () => {
  it('never shows a stale version in the footer and reports Degraded', async () => {
    stubVersions([
      { name: 'looprag', state: 'ok', checked_at: at, version: '0.35.0' },
      { name: 'looptrace', state: 'unreachable', checked_at: at, reason: 'connection refused' },
    ]);

    render(<SystemStatusIndicator />);

    // wait for the RESOLVED render — the element itself exists from the first paint
    // (that is the point of R1), so waiting on the element would assert the pending state
    await screen.findByText(/degraded/i);
    const indicator = screen.getByTestId('system-status-indicator');
    expect(indicator).not.toHaveTextContent(/0\.35\.0/);

    // EC-4: the label lives on the status region INSIDE the link, not on the link.
    const region = within(indicator).getByRole('status');
    expect(region.getAttribute('aria-label')).not.toMatch(/0\.35\.0/);
    expect(region.getAttribute('aria-label')).toBe('System status: 1 operational, 1 unreachable, 0 not configured, 0 without provenance');
  });

  it('shows Operational when every probed service is ok and one is merely not_deployed', async () => {
    stubVersions([
      { name: 'looprag', state: 'ok', checked_at: at, version: '0.35.0' },
      { name: 'loopstore', state: 'not_deployed', checked_at: at },
    ]);

    render(<SystemStatusIndicator />);

    expect(await screen.findByText(/operational/i)).toBeInTheDocument();
  });

  // D9 / EC-1 — nothing is down, but nothing is up either: there is no measured
  // health to claim, so the dot must not be green.
  it('never shows Operational when every service is not_deployed', async () => {
    stubVersions([
      { name: 'looprag', state: 'not_deployed', checked_at: at },
      { name: 'loopstore', state: 'not_deployed', checked_at: at },
    ]);

    render(<SystemStatusIndicator />);

    const region = await screen.findByRole('status');
    await waitFor(() =>
      expect(region.getAttribute('aria-label')).toBe('System status: 0 operational, 0 unreachable, 2 not configured, 0 without provenance'),
    );
    const indicator = screen.getByTestId('system-status-indicator');
    expect(indicator).not.toHaveTextContent(/operational/i);
    expect(indicator).toHaveTextContent(/checking/i);
  });

  // F-xval-1 / F-web-2 / F-wire-1 — the failure this milestone exists to remove,
  // in its softer form. The footer stopped claiming health it never measured and
  // started claiming a measurement was in flight that will never land: `cloudFetch`
  // without `throwOnError` RESOLVES null on any 5xx or network failure, so the query
  // SUCCEEDS with no data, `isPending` is false forever, and the level settles on
  // 'unknown' whose copy is the literal pending word. The /status page renders
  // role="alert" for exactly the same payload (status.test.tsx), so the two surfaces
  // disagree in precisely the case ADR D3 claims they cannot.
  it('says the status is unavailable — not "Checking…" — when the aggregate cannot be read', async () => {
    mockCloudFetch.mockResolvedValue(null);

    render(<SystemStatusIndicator />);

    const indicator = await screen.findByTestId('system-status-indicator');
    await waitFor(() => expect(indicator).toHaveTextContent(/unavailable/i));
    // "Checking…" asserts a probe still running. Nothing is running.
    expect(indicator).not.toHaveTextContent(/checking/i);
    expect(indicator).not.toHaveTextContent(/operational/i);
  });

  it('never announces measured-looking zeros for a read that never returned', async () => {
    mockCloudFetch.mockResolvedValue(null);

    render(<SystemStatusIndicator />);

    const region = await screen.findByRole('status');
    await waitFor(() => expect(region.getAttribute('aria-label')).toMatch(/unavailable/i));
    // Three zeros produced by a request that never landed read as a measurement.
    expect(region.getAttribute('aria-label')).not.toBe('System status: 0 operational, 0 unreachable, 0 not configured, 0 without provenance');
  });

  it('treats a rejected query the same as an unreadable one', async () => {
    mockCloudFetch.mockRejectedValue(new Error('network request failed'));

    render(<SystemStatusIndicator />);

    const indicator = await screen.findByTestId('system-status-indicator');
    await waitFor(() => expect(indicator).toHaveTextContent(/unavailable/i));
    expect(indicator).not.toHaveTextContent(/checking/i);
  });

  // The half of the fix that only production sees: with the default contract every
  // non-2xx resolves null, so the query SUCCEEDS and the retry guard in
  // lib/query-client.ts is inert for it. Opting in makes a failure an actual failure.
  it('opts into the throwing contract so a 5xx is an error, not a successful null', async () => {
    stubVersions([{ name: 'looprag', state: 'ok', checked_at: at, version: '0.35.0' }]);

    render(<SystemStatusIndicator />);
    await screen.findByText(/operational/i);

    // The path is asserted, not merely accepted: the constant is what
    // use-service-versions.test.ts binds to the Go route, so pinning the CALL to it
    // closes the remaining hole — a hook that goes back to a hardcoded literal.
    expect(mockCloudFetch).toHaveBeenCalledWith(
      SERVICE_VERSIONS_PATH,
      expect.anything(),
      expect.objectContaining({ throwOnError: true }),
    );
  });

  // R1 — the indicator is rendered on every authenticated page. It must never
  // suspend or return null, or a slow probe would hold the whole navigation.
  it('renders immediately while the query is pending, without suspending', () => {
    mockCloudFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<SystemStatusIndicator />);

    // synchronous on purpose: a suspending or null-returning component fails this getBy*
    expect(screen.getByTestId('system-status-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('system-status-indicator')).toHaveTextContent(/checking/i);
  });

  it('exposes a computed aria-label instead of the hardcoded sentence', async () => {
    stubVersions([{ name: 'looprag', state: 'ok', checked_at: at, version: '0.35.0' }]);

    render(<SystemStatusIndicator />);

    const region = await screen.findByRole('status');
    await waitFor(() =>
      expect(region.getAttribute('aria-label')).toBe('System status: 1 operational, 0 unreachable, 0 not configured, 0 without provenance'),
    );
    expect(region.getAttribute('aria-label')).not.toBe('System status: all systems operational');
  });

  // EC-4 — query by ROLE, not by attribute. `toHaveAttribute('href')` still passes
  // when `role="status"` sits on the <Link> itself, because the href stays in the
  // DOM while the `link` role is already overridden — and the indicator stops being
  // announced as something a keyboard/AT user can open.
  it('links to /status so clicking opens the page', async () => {
    stubVersions([{ name: 'looprag', state: 'ok', checked_at: at, version: '0.35.0' }]);
    render(<SystemStatusIndicator />);

    const link = await screen.findByRole('link', { name: /system status/i });
    expect(link).toHaveAttribute('href', '/status');
  });

  it('keeps the live status region inside the link, so it is both a link and a status', async () => {
    stubVersions([{ name: 'looprag', state: 'ok', checked_at: at, version: '0.35.0' }]);
    render(<SystemStatusIndicator />);

    const link = await screen.findByRole('link', { name: /system status/i });
    expect(within(link).getByRole('status')).toBeInTheDocument();
    expect(link.getAttribute('role')).toBeNull();
  });
});
