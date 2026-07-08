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
