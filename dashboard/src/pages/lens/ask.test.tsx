import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { LensAskPage } from './ask';

/**
 * M61 P2 T2.1 — the docked Ask page. The copilot is grounded in the URL trace (`?traceId=`) — there is
 * NO manual trace-id entry; a missing trace shows an honest EmptyState; a foreign trace whose ask 404s
 * fails closed (typed Alert, no fabricated answer — the cross-tenant refusal, DoD3 / R4).
 */

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) };
});

const tree = { spanId: 's1', traceId: 't1', name: 'agent.turn', children: [{ spanId: 's2', traceId: 't1', name: 'llm' }] };

describe('M61 LensAskPage (docked to the open trace)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('docks to ?traceId= — fetches the trace tree and renders the AskThread (no manual id Input)', async () => {
    mockCloudFetch.mockImplementation((url: string) =>
      url.includes('/ask') ? Promise.resolve({ answer: 'a' }) : Promise.resolve(tree),
    );
    render(<LensAskPage />, { initialEntries: ['/observability/ask?traceId=t1'] });
    expect(await screen.findByLabelText('Question')).toBeInTheDocument(); // the AskThread composer
    expect(mockCloudFetch.mock.calls.some((c) => c[0] === '/v1/dashboard/lens/traces/t1')).toBe(true);
    // the M44 manual trace-id Input is gone.
    expect(screen.queryByLabelText('Trace id')).toBeNull();
  });

  it('shows an EmptyState when no ?traceId= is present (no manual entry)', async () => {
    render(<LensAskPage />, { initialEntries: ['/observability/ask'] });
    expect(await screen.findByText(/open a trace and click ask/i)).toBeInTheDocument();
  });

  it('refuses a cross-tenant trace: a 404 ask fails closed (typed Alert, NO answer turn) — DoD3/R4', async () => {
    mockCloudFetch.mockImplementation((url: string) =>
      url.includes('/ask') ? Promise.reject(new ApiError(404)) : Promise.resolve(tree),
    );
    render(<LensAskPage />, { initialEntries: ['/observability/ask?traceId=foreign'] });
    await userEvent.type(await screen.findByLabelText('Question'), 'what happened');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText(/could not answer/i)).toBeInTheDocument();
    expect(screen.queryByTestId('thread-turn-assistant')).toBeNull(); // no billable/fabricated answer
  });
});
