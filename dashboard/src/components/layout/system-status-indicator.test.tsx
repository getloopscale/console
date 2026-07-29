// M21 T3.1 — the footer indicator that replaces the hardcoded `● Operational`.
//
// Every assertion here exists because the literal it replaces could not fail: the
// text, the dot and the aria-label all came from JSX with no data behind them.
//
// Data reaches the component through `vi.mock('@/lib/api')` (repo precedent:
// `src/pages/memory/graph.test.tsx:20-23`); a global fetch stub cannot deliver it
// because `cloudFetch` gates on `ensureToken()` first (`src/lib/api.ts:184-188`).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/render';

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
  engineFetch: (...args: unknown[]) => mockCloudFetch(...args),
}));

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
      { name: 'theo-rag', state: 'ok', checked_at: at, version: '0.35.0' },
      { name: 'theo-lens', state: 'unreachable', checked_at: at, reason: 'connection refused' },
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
    expect(region.getAttribute('aria-label')).toBe('System status: 1 operational, 1 unreachable, 0 not deployed');
  });

  it('shows Operational when every probed service is ok and one is merely not_deployed', async () => {
    stubVersions([
      { name: 'theo-rag', state: 'ok', checked_at: at, version: '0.35.0' },
      { name: 'theo-storage', state: 'not_deployed', checked_at: at },
    ]);

    render(<SystemStatusIndicator />);

    expect(await screen.findByText(/operational/i)).toBeInTheDocument();
  });

  // D9 / EC-1 — nothing is down, but nothing is up either: there is no measured
  // health to claim, so the dot must not be green.
  it('never shows Operational when every service is not_deployed', async () => {
    stubVersions([
      { name: 'theo-rag', state: 'not_deployed', checked_at: at },
      { name: 'theo-storage', state: 'not_deployed', checked_at: at },
    ]);

    render(<SystemStatusIndicator />);

    const region = await screen.findByRole('status');
    await waitFor(() =>
      expect(region.getAttribute('aria-label')).toBe('System status: 0 operational, 0 unreachable, 2 not deployed'),
    );
    const indicator = screen.getByTestId('system-status-indicator');
    expect(indicator).not.toHaveTextContent(/operational/i);
    expect(indicator).toHaveTextContent(/checking/i);
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
    stubVersions([{ name: 'theo-rag', state: 'ok', checked_at: at, version: '0.35.0' }]);

    render(<SystemStatusIndicator />);

    const region = await screen.findByRole('status');
    await waitFor(() =>
      expect(region.getAttribute('aria-label')).toBe('System status: 1 operational, 0 unreachable, 0 not deployed'),
    );
    expect(region.getAttribute('aria-label')).not.toBe('System status: all systems operational');
  });

  // EC-4 — query by ROLE, not by attribute. `toHaveAttribute('href')` still passes
  // when `role="status"` sits on the <Link> itself, because the href stays in the
  // DOM while the `link` role is already overridden — and the indicator stops being
  // announced as something a keyboard/AT user can open.
  it('links to /status so clicking opens the page', async () => {
    stubVersions([{ name: 'theo-rag', state: 'ok', checked_at: at, version: '0.35.0' }]);
    render(<SystemStatusIndicator />);

    const link = await screen.findByRole('link', { name: /system status/i });
    expect(link).toHaveAttribute('href', '/status');
  });

  it('keeps the live status region inside the link, so it is both a link and a status', async () => {
    stubVersions([{ name: 'theo-rag', state: 'ok', checked_at: at, version: '0.35.0' }]);
    render(<SystemStatusIndicator />);

    const link = await screen.findByRole('link', { name: /system status/i });
    expect(within(link).getByRole('status')).toBeInTheDocument();
    expect(link.getAttribute('role')).toBeNull();
  });
});
