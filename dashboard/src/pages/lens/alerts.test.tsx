import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { waitFor } from '@testing-library/react';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensAlertsPage, alertStatusVariant } from './alerts';

describe('alertStatusVariant (honest status badge)', () => {
  it('a firing rule is destructive, a cleared rule is success', () => {
    expect(alertStatusVariant('TRIGGERED', true)).toBe('destructive');
    expect(alertStatusVariant('OK', true)).toBe('success');
  });
  it('a disabled rule is neutral, NOT a green success', () => {
    // the bug: `status !== 'TRIGGERED' ? 'success'` painted a disabled/unknown rule green.
    expect(alertStatusVariant('OK', false)).toBe('outline');
    expect(alertStatusVariant('TRIGGERED', false)).toBe('outline');
  });
  it('an unknown status is neutral, never a fabricated success', () => {
    expect(alertStatusVariant('PENDING', true)).toBe('outline');
    expect(alertStatusVariant('', true)).toBe('outline');
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

  it('discloses "register a webhook first" when the workspace has none', async () => {
    mockRoutes({ webhooks: [] });
    render(<LensAlertsPage />);
    expect(await screen.findByText(/register a webhook first/i)).toBeInTheDocument();
    // #175: the instruction BODY renders (how to register), not just the title.
    expect(screen.getByText(/add one under settings/i)).toBeInTheDocument();
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
