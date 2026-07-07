import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensSessionsPage } from './sessions';
import { LensAgentsPage } from './agents';
import { LensAskPage } from './ask';

function mutatingCalls() {
  return mockCloudFetch.mock.calls.filter((c) => {
    const m = (c[1] as { method?: string })?.method;
    return m === 'POST' || m === 'DELETE' || m === 'PUT' || m === 'PATCH';
  });
}

describe('Lens read-only pages make no mutating calls', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sessions renders and issues zero mutating calls', async () => {
    mockCloudFetch.mockResolvedValue({ sessions: [{ sessionId: 'ses_1', traceCount: 3 }] });
    render(<LensSessionsPage />);
    expect(await screen.findByText('ses_1')).toBeInTheDocument();
    expect(mutatingCalls()).toHaveLength(0);
  });

  it('agents renders and issues zero mutating calls', async () => {
    mockCloudFetch.mockResolvedValue({ agents: [{ name: 'checkout-agent', traceCount: 5 }] });
    render(<LensAgentsPage />);
    expect(await screen.findByText('checkout-agent')).toBeInTheDocument();
    expect(mutatingCalls()).toHaveLength(0);
  });

});

describe('LensAskPage (copilot, read-scope)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M61 — docked to ?traceId=, asks via POST /traces/{id}/ask and renders the answer (no manual id)', async () => {
    // M61 rebuild: the trace context is carried in the URL (no manual "Trace id" Input); the page
    // fetches the trace tree, then each turn is a POST to the M33 ask endpoint.
    mockCloudFetch.mockImplementation((url: string) =>
      url.includes('/ask')
        ? Promise.resolve({ answer: 'because the tool failed' })
        : Promise.resolve({ spanId: 'tr_1', traceId: 'tr_1', name: 'root' }),
    );
    render(<LensAskPage />, { initialEntries: ['/observability/ask?traceId=tr_1'] });
    await userEvent.type(await screen.findByLabelText(/question/i), 'why did it fail?');
    await userEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(
      mockCloudFetch.mock.calls.some(
        (c) => c[0] === '/v1/dashboard/lens/traces/tr_1/ask' && (c[1] as { method?: string })?.method === 'POST',
      ),
    ).toBe(true);
    expect(await screen.findByText('because the tool failed')).toBeInTheDocument();
  });
});
