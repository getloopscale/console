import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensGuardsPage } from './guards';

describe('LensGuardsPage (/observability/guards)', () => {
  beforeEach(() => vi.clearAllMocks());

  // #179 — pick the evaluator from a <Select> (fed by GET /evaluators), not a free-text id.
  function withEvaluators(evaluators = [{ id: 'ev_1', name: 'Answer relevance' }]) {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url === '/v1/dashboard/lens/evaluators') return Promise.resolve({ evaluators });
      return Promise.resolve({ guards: [] });
    });
  }

  // M77 — a guard whose breaches can be inspected. Wires evaluators + one guard + a breaches read.
  function withGuardAndBreaches(traceIds: string[]) {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url === '/v1/dashboard/lens/evaluators') return Promise.resolve({ evaluators: [{ id: 'ev_1', name: 'Answer relevance' }] });
      if (/\/guards\/gd_1\/breaches$/.test(url)) return Promise.resolve({ traceIds });
      if (url === '/v1/dashboard/lens/guards') return Promise.resolve({ guards: [{ id: 'gd_1', evaluatorId: 'ev_1', operator: 'gte', threshold: 0.8 }] });
      return Promise.resolve({});
    });
  }

  it('M77 — View breaches lists the breaching traces, each deep-linking to its trace peek', async () => {
    withGuardAndBreaches(['tr-a', 'tr-b']);
    render(<LensGuardsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /view breaches/i }));
    // the breaches read fires for this guard
    expect(mockCloudFetch.mock.calls.some((c) => /\/guards\/gd_1\/breaches$/.test(String(c[0])))).toBe(true);
    // each breaching trace is a link to its ?trace= peek (M76)
    const a = await screen.findByRole('link', { name: /tr-a/i });
    expect(a).toHaveAttribute('href', '/observability/traces?trace=tr-a');
    expect(screen.getByRole('link', { name: /tr-b/i })).toHaveAttribute('href', '/observability/traces?trace=tr-b');
  });

  it('M77 — the breaches panel shows the guard rule and an honest empty state', async () => {
    withGuardAndBreaches([]); // no trace has failed this guard
    render(<LensGuardsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /view breaches/i }));
    // the guard rule is shown as context (evaluator name + operator symbol + threshold) in the description
    expect(await screen.findByText(/Traces failing Answer relevance ≥ 0\.8/)).toBeInTheDocument();
    // honest empty state — no fabricated breach
    expect(screen.getByText(/no trace has failed this guard/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open trace/i })).not.toBeInTheDocument();
  });

  it('M77 — a failed breaches read fails closed to a typed Alert (never a silent empty state)', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url === '/v1/dashboard/lens/evaluators') return Promise.resolve({ evaluators: [{ id: 'ev_1', name: 'Answer relevance' }] });
      if (/\/guards\/gd_1\/breaches$/.test(url)) return Promise.resolve().then(() => { throw Object.assign(new Error('down'), { status: 502 }); });
      if (url === '/v1/dashboard/lens/guards') return Promise.resolve({ guards: [{ id: 'gd_1', evaluatorId: 'ev_1', operator: 'gte', threshold: 0.8 }] });
      return Promise.resolve({});
    });
    render(<LensGuardsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /view breaches/i }));
    expect(await screen.findByTestId('breaches-error')).toBeInTheDocument();
    // fail-closed: the empty-state text must NOT show (a failure is not "no breaches")
    expect(screen.queryByText(/no trace has failed this guard/i)).not.toBeInTheDocument();
  });

  it('creates a guard by SELECTING an evaluator + operator (no free-text id) — #179', async () => {
    withEvaluators();
    render(<LensGuardsPage />);
    await screen.findByText(/no guards yet/i);

    // the evaluator is a Select fed by GET /evaluators, labelled by name (not a free-text id box)
    await userEvent.click(screen.getByRole('combobox', { name: /evaluator/i }));
    await userEvent.click(await screen.findByRole('option', { name: /answer relevance/i }));
    await userEvent.type(screen.getByLabelText(/threshold/i), '0.8');
    await userEvent.click(screen.getByRole('button', { name: /create guard/i }));

    const call = mockCloudFetch.mock.calls.find(
      (c) => c[0] === '/v1/dashboard/lens/guards' && (c[1] as { method?: string })?.method === 'POST',
    );
    expect(call).toBeTruthy();
    const body = JSON.parse((call![1] as { body: string }).body);
    expect(body.evaluatorId).toBe('ev_1'); // the SELECTED id (value), surfaced by name
    expect(body.operator).toBe('gte');
    expect(body.threshold).toBe(0.8);
  });

  it('hides the threshold and omits it for a label_eq guard — #179', async () => {
    withEvaluators();
    render(<LensGuardsPage />);
    await screen.findByText(/no guards yet/i);
    await userEvent.click(screen.getByRole('combobox', { name: /evaluator/i }));
    await userEvent.click(await screen.findByRole('option', { name: /answer relevance/i }));
    // pick the label_eq operator → the threshold field disappears
    await userEvent.click(screen.getByRole('combobox', { name: /operator/i }));
    await userEvent.click(await screen.findByRole('option', { name: /matches label/i }));
    expect(screen.queryByLabelText(/threshold/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /create guard/i }));

    const call = mockCloudFetch.mock.calls.find(
      (c) => c[0] === '/v1/dashboard/lens/guards' && (c[1] as { method?: string })?.method === 'POST',
    );
    const body = JSON.parse((call![1] as { body: string }).body);
    expect(body.operator).toBe('label_eq');
    expect(body.threshold).toBeUndefined(); // no fabricated threshold for a label match
  });

  it('M73 — the empty state has a CTA that focuses the create form (one clear action)', async () => {
    mockCloudFetch.mockResolvedValue({ guards: [] });
    render(<LensGuardsPage />);
    await screen.findByText(/no guards yet/i);
    await userEvent.click(screen.getByRole('button', { name: /create your first guard/i }));
    expect(screen.getByRole('combobox', { name: /evaluator/i })).toHaveFocus();
  });

  it('renders empty state and delete flow via ConfirmDialog', async () => {
    mockCloudFetch.mockResolvedValue({ guards: [{ id: 'gd_1', evaluatorId: 'ev_1', operator: 'gte', threshold: 0.8 }] });
    render(<LensGuardsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /delete gd_1/i }));
    await userEvent.click(await screen.findByRole('button', { name: /delete guard/i }));
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/lens/guards/gd_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
