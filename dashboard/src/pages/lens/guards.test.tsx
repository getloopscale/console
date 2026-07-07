import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensGuardsPage } from './guards';

describe('LensGuardsPage (/observability/guards)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a guard via POST with {evaluatorId,operator}', async () => {
    mockCloudFetch.mockResolvedValue({ guards: [] });
    render(<LensGuardsPage />);
    await screen.findByText(/no guards yet/i);

    await userEvent.type(screen.getByLabelText(/^evaluator$/i), 'ev_1');
    await userEvent.type(screen.getByLabelText(/threshold/i), '0.8');
    await userEvent.click(screen.getByRole('button', { name: /create guard/i }));

    const call = mockCloudFetch.mock.calls.find(
      (c) => c[0] === '/v1/dashboard/lens/guards' && (c[1] as { method?: string })?.method === 'POST',
    );
    expect(call).toBeTruthy();
    const body = JSON.parse((call![1] as { body: string }).body);
    expect(body.evaluatorId).toBe('ev_1');
    expect(body.operator).toBe('gte');
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
