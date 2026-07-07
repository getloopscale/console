import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import type { TraceSpanNode } from '@/lib/trace-layout';
import { STARTER_PROMPTS } from './ask-thread-model';
import { AskThread } from './ask-thread';

/**
 * M61 P1 T1.1 — the AskThread. A client-side multi-turn thread over the single-turn M33 ask. The
 * security-critical invariants: fail-closed on a provider error (typed Alert, NO fabricated answer,
 * NO billable retry — R4); no cross-trace bleed (the thread clears on a traceId change — R1); XSS-safe
 * answer render (R2); and honest span-citations (R3, D4).
 */

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) };
});

const tree = {
  spanId: 's1',
  traceId: 't1',
  name: 'agent.turn',
  children: [{ spanId: 's2', traceId: 't1', name: 'llm' }],
} as TraceSpanNode;

async function ask(question: string) {
  await userEvent.type(screen.getByLabelText('Question'), question);
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
}

describe('M61 AskThread', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accretes a multi-turn thread (2 asks → 4 role-labeled turns)', async () => {
    mockCloudFetch.mockResolvedValueOnce({ answer: 'first answer' }).mockResolvedValueOnce({ answer: 'second answer' });
    render(<AskThread traceId="t1" spans={tree} />);
    await ask('q1');
    await screen.findByText('first answer');
    await ask('q2');
    await screen.findByText('second answer');
    expect(screen.getAllByTestId(/thread-turn/)).toHaveLength(4); // 2 user + 2 assistant
  });

  it('fills the composer when a starter prompt is clicked', async () => {
    render(<AskThread traceId="t1" spans={tree} />);
    await userEvent.click(screen.getByRole('button', { name: STARTER_PROMPTS[0] }));
    expect(screen.getByLabelText('Question')).toHaveValue(STARTER_PROMPTS[0]);
  });

  it('fails closed on a provider error — typed Alert, NO assistant turn, exactly ONE POST (R4)', async () => {
    mockCloudFetch.mockRejectedValue(new ApiError(503));
    render(<AskThread traceId="t1" spans={tree} />);
    await ask('why did this fail');
    // fail-closed: the "Could not answer" Alert shows (the per-status typed body is set from err.status).
    expect(await screen.findByText(/could not answer/i)).toBeInTheDocument();
    expect(screen.queryByTestId('thread-turn-assistant')).toBeNull(); // no fabricated answer
    expect(mockCloudFetch).toHaveBeenCalledTimes(1); // retry: false — no billable loop
  });

  it('does NOT bleed one trace’s thread into another (clears on traceId change — R1)', async () => {
    mockCloudFetch.mockResolvedValue({ answer: 'A' });
    const { rerender } = render(<AskThread traceId="t1" spans={tree} />);
    await ask('q');
    await screen.findByTestId('thread-turn-assistant');
    expect(screen.getAllByTestId(/thread-turn/).length).toBeGreaterThan(0);
    rerender(<AskThread traceId="t2" spans={tree} />); // open a different trace
    expect(screen.queryAllByTestId(/thread-turn/)).toHaveLength(0); // fresh thread
  });

  it('resolves a [span:id] citation to a linked span name (D4)', async () => {
    mockCloudFetch.mockResolvedValue({ answer: 'the slow step is [span:s2] here' });
    render(<AskThread traceId="t1" spans={tree} />);
    await ask('what is slow');
    const cite = await screen.findByTestId('span-citation');
    expect(cite).toHaveTextContent('llm');
  });

  it('renders the answer XSS-safe (a <script> answer draws no script node — R2)', async () => {
    mockCloudFetch.mockResolvedValue({ answer: '<script>alert(1)</script> hello' });
    const { container } = render(<AskThread traceId="t1" spans={tree} />);
    await ask('summarize');
    await screen.findByTestId('thread-turn-assistant');
    expect(container.querySelector('script')).toBeNull();
  });

  it('grounds a turn on a span and cites it (re: spanName) — D4', async () => {
    mockCloudFetch.mockResolvedValue({ answer: 'ok' });
    render(<AskThread traceId="t1" spans={tree} initialSpanId="s2" />);
    await ask('explain this step');
    expect(await screen.findAllByText(/re: llm/i)).not.toHaveLength(0);
  });
});
