import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensSessionsPage } from './sessions';
import { LensAgentsPage } from './agents';
import { LensAnalyticsPage } from './analytics';
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

  it('analytics renders observability + cost metrics', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url.includes('observability')) return Promise.resolve({ traces: 42, errorRate: 0.05 });
      if (url.includes('cost')) return Promise.resolve({ totalUsd: 1.5 });
      return Promise.resolve({});
    });
    render(<LensAnalyticsPage />);
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('$1.50')).toBeInTheDocument();
  });
});

describe('LensAskPage (copilot, read-scope)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks via POST /traces/{id}/ask and renders the answer without invalidation', async () => {
    mockCloudFetch.mockResolvedValue({ answer: 'because the tool failed' });
    render(<LensAskPage />);
    await userEvent.type(screen.getByLabelText(/trace id/i), 'tr_1');
    await userEvent.type(screen.getByLabelText(/question/i), 'why did it fail?');
    await userEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/lens/traces/tr_1/ask',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(await screen.findByText('because the tool failed')).toBeInTheDocument();
  });
});
