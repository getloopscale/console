import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensEvaluatorsPage } from './evaluators';

describe('LensEvaluatorsPage (/observability/evaluators)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an evaluator via POST with {kind,config}', async () => {
    mockCloudFetch.mockResolvedValue({ evaluators: [] });
    render(<LensEvaluatorsPage />);
    await screen.findByText(/no evaluators yet/i);

    await userEvent.type(screen.getByLabelText(/new evaluator name/i), 'nonempty');
    await userEvent.type(screen.getByLabelText(/rule predicate/i), 'output.length > 0');
    await userEvent.click(screen.getByRole('button', { name: /create evaluator/i }));

    const call = mockCloudFetch.mock.calls.find(
      (c) => c[0] === '/v1/dashboard/lens/evaluators' && (c[1] as { method?: string })?.method === 'POST',
    );
    expect(call).toBeTruthy();
    const body = JSON.parse((call![1] as { body: string }).body);
    expect(body.kind).toBe('rule');
    expect(body.config).toEqual({ predicate: 'output.length > 0' });
  });

  it('runs an evaluator via POST /run', async () => {
    mockCloudFetch.mockResolvedValue({ evaluators: [{ id: 'ev_1', name: 'r', kind: 'rule' }] });
    render(<LensEvaluatorsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /run r/i }));
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/lens/evaluators/ev_1/run',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('delete opens ConfirmDialog then calls DELETE on confirm', async () => {
    mockCloudFetch.mockResolvedValue({ evaluators: [{ id: 'ev_1', name: 'r', kind: 'rule' }] });
    render(<LensEvaluatorsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /delete ev_1/i }));
    await userEvent.click(await screen.findByRole('button', { name: /delete evaluator/i }));
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/lens/evaluators/ev_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
