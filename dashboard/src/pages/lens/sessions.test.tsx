import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensSessionsPage } from './sessions';

describe('LensSessionsPage (/observability/sessions)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M70 — a session row jumps to the traces list pre-filtered by session (no dead-end)', async () => {
    mockCloudFetch.mockResolvedValue({ sessions: [{ sessionId: 'sess-abc', traceCount: 4 }] });
    render(<LensSessionsPage />);
    const link = await screen.findByRole('link', { name: /view traces/i });
    expect(link).toHaveAttribute('href', '/observability/traces?session=sess-abc');
  });

  // M74 (audit S-1) — the empty state must name the `session.id` grouping key so a user with
  // traces-but-no-sessions understands what a session requires.
  it('M74 — the empty state names the session.id grouping key + a docs CTA', async () => {
    mockCloudFetch.mockResolvedValue({ sessions: [] });
    render(<LensSessionsPage />);
    expect(await screen.findByText(/session\.id/i)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /instrument/i });
    expect(cta).toHaveAttribute('href', expect.stringMatching(/observability/i));
  });

  it('M74 — the grouping-key hint does NOT render when sessions are present', async () => {
    mockCloudFetch.mockResolvedValue({ sessions: [{ sessionId: 'sess-abc', traceCount: 4 }] });
    render(<LensSessionsPage />);
    await screen.findByRole('link', { name: /view traces/i });
    expect(screen.queryByText(/session\.id/i)).not.toBeInTheDocument();
  });

  it('an absent trace count renders em-dash, a real 0 renders 0', async () => {
    mockCloudFetch.mockResolvedValue({
      sessions: [{ sessionId: 'sess-1' }, { sessionId: 'sess-2', traceCount: 0 }],
    });
    render(<LensSessionsPage />);
    expect(await screen.findByText('—')).toBeInTheDocument(); // absent
    expect(screen.getByText('0')).toBeInTheDocument(); // honest zero
  });
});
