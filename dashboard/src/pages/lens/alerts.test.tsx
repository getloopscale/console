import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { waitFor } from '@testing-library/react';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensAlertsPage, alertSeverity } from './alerts';

describe('alertSeverity (honest status → Severity)', () => {
  it('a firing rule is alert, a cleared rule is ok', () => {
    // SeverityBadge maps alert→destructive, ok→success (verified in @usetheo/ui).
    expect(alertSeverity('TRIGGERED', true)).toBe('alert');
    expect(alertSeverity('OK', true)).toBe('ok');
  });
  it('a disabled rule is paused (inert/neutral), NOT a green ok', () => {
    // the bug: `status !== 'TRIGGERED' ? 'success'` painted a disabled/unknown rule green.
    expect(alertSeverity('OK', false)).toBe('paused');
    expect(alertSeverity('TRIGGERED', false)).toBe('paused');
  });
  it('an unknown status is unknown (neutral), never a fabricated ok', () => {
    expect(alertSeverity('PENDING', true)).toBe('unknown');
    expect(alertSeverity('', true)).toBe('unknown');
  });
});

const RULES = '/v1/dashboard/lens/alert-rules';
const WEBHOOKS = '/v1/settings/webhooks/list';

function mockRoutes(opts: { rules?: unknown[]; webhooks?: unknown[] } = {}) {
  mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
    if (url === RULES && (!init || init.method === undefined)) return Promise.resolve({ alert_rules: opts.rules ?? [] });
    if (url === WEBHOOKS) return Promise.resolve({ webhooks: opts.webhooks ?? [{ id: 'wwh-1', label: 'prod hook' }] });
    if (url === RULES && init?.method === 'POST') return Promise.resolve({ id: 'lar-new', name: 'x', status: 'OK' });
    if (url.startsWith(`${RULES}/`) && init?.method === 'DELETE') return Promise.resolve({});
    if (url.startsWith(`${RULES}/`) && init?.method === 'PATCH') return Promise.resolve({});
    return Promise.resolve({});
  });
}
const calls = (method: string) =>
  mockCloudFetch.mock.calls.filter((c) => typeof c[0] === 'string' && (c[0] as string).includes('/alert-rules') && (c[1] as { method?: string })?.method === method);

describe('LensAlertsPage (M53)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists rules with a status badge (TRIGGERED)', async () => {
    mockRoutes({
      rules: [
        { id: 'lar-1', name: 'high errors', metric: 'error_rate', comparator: 'gt', threshold: 5, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'TRIGGERED', last_evaluated_at: null, last_triggered_at: '2026-07-04T10:00:00Z' },
      ],
    });
    render(<LensAlertsPage />);
    expect(await screen.findByText('high errors')).toBeInTheDocument();
    expect(screen.getByText('TRIGGERED')).toBeInTheDocument();
  });

  it('empty state when no rules', async () => {
    mockRoutes({ rules: [] });
    render(<LensAlertsPage />);
    expect(await screen.findByText(/no alert rules yet/i)).toBeInTheDocument();
  });

  it('M84 — a rule row expands its firing history (value vs threshold, when)', async () => {
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === RULES && (!init || init.method === undefined))
        return Promise.resolve({ alert_rules: [{ id: 'lar-1', name: 'high errors', metric: 'error_rate', comparator: 'gt', threshold: 5, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'TRIGGERED', last_evaluated_at: null, last_triggered_at: '2026-07-04T10:00:00Z' }] });
      if (url === WEBHOOKS) return Promise.resolve({ webhooks: [{ id: 'wwh-1', label: 'prod' }] });
      if (url.includes('/history'))
        return Promise.resolve({ firings: [{ id: 'lfa-1', metric: 'error_rate', comparator: 'gt', threshold: 5, value: 12, fired_at: '2026-07-04T10:00:00Z' }], total: 1, limit: 20, offset: 0 });
      return Promise.resolve({});
    });
    render(<LensAlertsPage />);
    await screen.findByText('high errors');
    await userEvent.click(screen.getByRole('button', { name: /history for high errors/i }));
    await waitFor(() => expect(mockCloudFetch.mock.calls.some((c) => String(c[0]).includes('/alert-rules/lar-1/history'))).toBe(true));
    expect(await screen.findByText(/12/)).toBeInTheDocument();
  });

  it('M84 — a rule that never fired shows an honest "never fired" empty, not a fabricated row', async () => {
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === RULES && (!init || init.method === undefined))
        return Promise.resolve({ alert_rules: [{ id: 'lar-1', name: 'quiet', metric: 'cost', comparator: 'gt', threshold: 5, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'OK', last_evaluated_at: null, last_triggered_at: null }] });
      if (url === WEBHOOKS) return Promise.resolve({ webhooks: [{ id: 'wwh-1', label: 'prod' }] });
      if (url.includes('/history')) return Promise.resolve({ firings: [], total: 0, limit: 20, offset: 0 });
      return Promise.resolve({});
    });
    render(<LensAlertsPage />);
    await screen.findByText('quiet');
    await userEvent.click(screen.getByRole('button', { name: /history for quiet/i }));
    expect(await screen.findByText(/never fired/i)).toBeInTheDocument();
  });

  it('M84 — a failed history load fails closed to a typed alert (not an empty "never fired")', async () => {
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === RULES && (!init || init.method === undefined))
        return Promise.resolve({ alert_rules: [{ id: 'lar-1', name: 'boom', metric: 'cost', comparator: 'gt', threshold: 5, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'OK', last_evaluated_at: null, last_triggered_at: null }] });
      if (url === WEBHOOKS) return Promise.resolve({ webhooks: [{ id: 'wwh-1', label: 'prod' }] });
      if (url.includes('/history')) return Promise.reject(Object.assign(new Error('boom'), { status: 500 }));
      return Promise.resolve({});
    });
    render(<LensAlertsPage />);
    await screen.findByText('boom');
    await userEvent.click(screen.getByRole('button', { name: /history for boom/i }));
    expect(await screen.findByText(/could not load .*history/i)).toBeInTheDocument();
    expect(screen.queryByText(/never fired/i)).not.toBeInTheDocument();
  });

  it('discloses "register a webhook first" when the workspace has none', async () => {
    mockRoutes({ webhooks: [] });
    render(<LensAlertsPage />);
    expect(await screen.findByText(/register a webhook first/i)).toBeInTheDocument();
    // #175: the instruction BODY renders (how to register), not just the title.
    expect(screen.getByText(/add one under/i)).toBeInTheDocument();
    // M86: the prerequisite points at the IN-OBSERVABILITY webhooks surface, so alert setup stays in
    // one module (no jump to /settings/webhooks).
    expect(screen.getByRole('link', { name: /webhooks/i })).toHaveAttribute('href', '/observability/webhooks');
  });

  it('creates a rule (POST metric/comparator/threshold/window/webhook_id)', async () => {
    mockRoutes({});
    render(<LensAlertsPage />);
    await screen.findByRole('button', { name: /create rule/i });
    await userEvent.type(screen.getByLabelText(/rule name/i), 'high errors');
    await userEvent.type(screen.getByLabelText(/^threshold$/i), '5');
    // pick the webhook (Radix Select)
    await userEvent.click(screen.getByRole('combobox', { name: /notify webhook/i }));
    await userEvent.click(await screen.findByRole('option', { name: /prod hook/i }));
    await userEvent.click(screen.getByRole('button', { name: /create rule/i }));
    await waitFor(() => expect(calls('POST').length).toBe(1));
    const body = JSON.parse((calls('POST')[0][1] as { body: string }).body);
    expect(body).toMatchObject({ name: 'high errors', metric: 'error_rate', comparator: 'gt', threshold: 5, webhook_id: 'wwh-1' });
    expect(body.window_seconds).toBe(3600);
  });

  it('create is disabled until name, threshold and webhook are set', async () => {
    mockRoutes({});
    render(<LensAlertsPage />);
    await screen.findByRole('button', { name: /create rule/i });
    expect(screen.getByRole('button', { name: /create rule/i })).toBeDisabled();
  });

  it('M72 — a failed toggle surfaces a write-error Alert (not silent)', async () => {
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === RULES && (!init || init.method === undefined))
        return Promise.resolve({ alert_rules: [{ id: 'lar-1', name: 'r', metric: 'cost', comparator: 'gt', threshold: 1, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'OK', last_evaluated_at: null, last_triggered_at: null }] });
      if (url === WEBHOOKS) return Promise.resolve({ webhooks: [{ id: 'wwh-1', label: 'h' }] });
      if (url.startsWith(`${RULES}/`) && init?.method === 'PATCH')
        return Promise.reject(Object.assign(new Error('boom'), { status: 403 }));
      return Promise.resolve({});
    });
    render(<LensAlertsPage />);
    await screen.findByText('r');
    await userEvent.click(screen.getByRole('button', { name: /toggle r/i }));
    expect(await screen.findByTestId('alerts-write-error')).toBeInTheDocument();
    expect(screen.getByText(/could not toggle the alert rule/i)).toBeInTheDocument();
  });

  it('toggles a rule enabled (PATCH)', async () => {
    mockRoutes({ rules: [{ id: 'lar-1', name: 'r', metric: 'cost', comparator: 'gt', threshold: 1, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'OK', last_evaluated_at: null, last_triggered_at: null }] });
    render(<LensAlertsPage />);
    await screen.findByText('r');
    // M71 — the enable toggle exposes its state via aria-pressed (an enabled rule → pressed)
    expect(screen.getByRole('button', { name: /toggle r/i })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /toggle r/i }));
    await waitFor(() => expect(calls('PATCH').length).toBe(1));
    expect(JSON.parse((calls('PATCH')[0][1] as { body: string }).body)).toEqual({ enabled: false });
  });

  it('M98 — the toggle flips OPTIMISTICALLY before the PATCH resolves (no stale RTT gap)', async () => {
    let resolvePatch!: () => void;
    const rule = { id: 'lar-1', name: 'r', metric: 'cost', comparator: 'gt', threshold: 1, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'OK', last_evaluated_at: null, last_triggered_at: null };
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === RULES && (!init || init.method === undefined)) return Promise.resolve({ alert_rules: [rule] });
      if (url === WEBHOOKS) return Promise.resolve({ webhooks: [{ id: 'wwh-1', label: 'prod hook' }] });
      if (url.startsWith(`${RULES}/`) && init?.method === 'PATCH') return new Promise<void>((res) => (resolvePatch = res));
      return Promise.resolve({});
    });
    render(<LensAlertsPage />);
    await screen.findByText('r');
    const btn = screen.getByRole('button', { name: /toggle r/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(btn);
    // optimistic: aria-pressed flips to false + the button is disabled WHILE the PATCH is still pending
    await waitFor(() => expect(screen.getByRole('button', { name: /toggle r/i })).toHaveAttribute('aria-pressed', 'false'));
    expect(screen.getByRole('button', { name: /toggle r/i })).toBeDisabled();
    resolvePatch();
  });

  it('M98 — a failed toggle ROLLS BACK the optimistic flip (never diverges from the server)', async () => {
    const rule = { id: 'lar-1', name: 'r', metric: 'cost', comparator: 'gt', threshold: 1, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'OK', last_evaluated_at: null, last_triggered_at: null };
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === RULES && (!init || init.method === undefined)) return Promise.resolve({ alert_rules: [rule] });
      if (url === WEBHOOKS) return Promise.resolve({ webhooks: [{ id: 'wwh-1', label: 'prod hook' }] });
      if (url.startsWith(`${RULES}/`) && init?.method === 'PATCH') return Promise.reject(Object.assign(new Error('boom'), { status: 500 }));
      return Promise.resolve({});
    });
    render(<LensAlertsPage />);
    await screen.findByText('r');
    await userEvent.click(screen.getByRole('button', { name: /toggle r/i }));
    // after the failed PATCH, aria-pressed reverts to true (rolled back to the server truth)
    await waitFor(() => expect(screen.getByRole('button', { name: /toggle r/i })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('deletes a rule after confirmation (DELETE)', async () => {
    mockRoutes({ rules: [{ id: 'lar-9', name: 'junk', metric: 'cost', comparator: 'gt', threshold: 1, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'OK', last_evaluated_at: null, last_triggered_at: null }] });
    render(<LensAlertsPage />);
    await screen.findByText('junk');
    await userEvent.click(screen.getByRole('button', { name: /delete junk/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^delete rule$/i }));
    await waitFor(() => expect(calls('DELETE').length).toBe(1));
    expect(calls('DELETE')[0][0]).toContain('/alert-rules/lar-9');
  });
});
