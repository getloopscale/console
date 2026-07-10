import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import type { TraceSpanNode } from '@/lib/trace-layout';
import { STARTER_PROMPTS } from './ask-thread-model';
import { AskThread, errorMessage } from './ask-thread';

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
    // M71 — the thread is a polite log live-region so new answers are announced by a screen reader
    expect(screen.getByRole('log', { name: /copilot conversation/i })).toHaveAttribute('aria-live', 'polite');
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
    // fail-closed: the "Could not answer" Alert shows; NO fabricated answer turn; exactly one POST.
    expect(await screen.findByText(/could not answer/i)).toBeInTheDocument();
    expect(screen.queryByTestId('thread-turn-assistant')).toBeNull();
    expect(mockCloudFetch).toHaveBeenCalledTimes(1); // retry: false — no billable loop
  });

  it('maps each fail-closed status to an honest typed message (errorMessage)', () => {
    expect(errorMessage({ status: 503 })).toMatch(/not configured/i);
    expect(errorMessage({ status: 502 })).toMatch(/failed to answer/i);
    expect(errorMessage({ status: 429 })).toMatch(/rate limit/i);
    expect(errorMessage({ status: 404 })).toMatch(/another workspace/i);
    expect(errorMessage(new Error('x'))).toMatch(/could not answer/i); // unknown → generic
  });

  it('drops an in-flight answer after the traceId changed (async no-cross-trace-bleed — R1)', async () => {
    let resolveAsk!: (v: { answer: string }) => void;
    mockCloudFetch.mockReturnValue(new Promise((res) => (resolveAsk = res)));
    const { rerender } = render(<AskThread traceId="t1" spans={tree} />);
    await ask('q for t1'); // submitted on t1, still in flight
    rerender(<AskThread traceId="t2" spans={tree} />); // open a DIFFERENT trace mid-flight
    resolveAsk({ answer: 'stale t1 answer' }); // the in-flight t1 ask now resolves
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('stale t1 answer')).toBeNull(); // the stale answer never landed under t2
    expect(screen.queryAllByTestId(/thread-turn/)).toHaveLength(0); // t2 thread stays empty
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

  it('M80 — a span citation is clickable, linking to its span in the trace peek (?trace=&spanId=)', async () => {
    mockCloudFetch.mockResolvedValue({ answer: 'the slow step is [span:s2] here' });
    render(<AskThread traceId="t1" spans={tree} />);
    await ask('what is slow');
    const cite = await screen.findByTestId('span-citation');
    // the citation is a link that opens the peek (M76 ?trace=) with the cited span selected (?spanId=)
    expect(cite.closest('a')).toHaveAttribute('href', '/observability/traces?trace=t1&spanId=s2');
  });

  it('M80 — an unknown [span:id] stays plain text with NO link (never a dangling citation)', async () => {
    mockCloudFetch.mockResolvedValue({ answer: 'the step [span:nope] failed' });
    render(<AskThread traceId="t1" spans={tree} />);
    await ask('what happened');
    const turn = await screen.findByTestId('thread-turn-assistant');
    expect(turn).toHaveTextContent('[span:nope]'); // unresolved marker stays literal
    expect(turn.querySelector('a')).toBeNull(); // no link rendered for an unknown span
    expect(screen.queryByTestId('span-citation')).not.toBeInTheDocument();
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

  it('M83 — a thumbs-up on an answer POSTs feedback {turnId,label} to the endpoint', async () => {
    mockCloudFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      void opts;
      if (String(url).includes('/ask/feedback')) return Promise.resolve({ label: 'up' });
      return Promise.resolve({ answer: 'here is why' });
    });
    render(<AskThread traceId="t1" spans={tree} />);
    await ask('why did it fail?');
    await screen.findByTestId('thread-turn-assistant');
    await userEvent.click(screen.getByRole('button', { name: /good answer/i }));
    const call = mockCloudFetch.mock.calls.find((c) => String(c[0]).includes('/ask/feedback'));
    expect(call).toBeTruthy();
    expect(String(call![0])).toBe('/v1/dashboard/lens/traces/t1/ask/feedback');
    const body = JSON.parse((call![1] as { body: string }).body);
    expect(body.label).toBe('up');
    expect(typeof body.turnId).toBe('string');
    expect(body.turnId.length).toBeGreaterThan(0);
  });

  it('M83 — a failed feedback POST fails closed to a typed error AND reverts the pressed thumb (no fabricated success)', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (String(url).includes('/ask/feedback')) return Promise.reject(new ApiError(502));
      return Promise.resolve({ answer: 'here is why' });
    });
    render(<AskThread traceId="t1" spans={tree} />);
    await ask('why?');
    await screen.findByTestId('thread-turn-assistant');
    const down = screen.getByRole('button', { name: /bad answer/i });
    await userEvent.click(down);
    expect(await screen.findByText(/could not save your feedback/i)).toBeInTheDocument();
    expect(down).toHaveAttribute('aria-pressed', 'false'); // reverted — UI must not show a vote that did not persist
  });

  it('M83 — clicking the active thumb clears via DELETE (persists the retract, no UI/DB divergence)', async () => {
    mockCloudFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).includes('/ask/feedback')) return Promise.resolve(opts?.method === 'DELETE' ? undefined : { label: 'up' });
      return Promise.resolve({ answer: 'here is why' });
    });
    render(<AskThread traceId="t1" spans={tree} />);
    await ask('why?');
    await screen.findByTestId('thread-turn-assistant');
    const up = screen.getByRole('button', { name: /good answer/i });
    await userEvent.click(up); // vote up (POST)
    expect(up).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(up); // click active thumb → clear (DELETE)
    const del = mockCloudFetch.mock.calls.find((c) => (c[1] as { method?: string })?.method === 'DELETE');
    expect(del).toBeTruthy();
    expect(String(del![0])).toContain('/ask/feedback?turnId=');
    expect(up).toHaveAttribute('aria-pressed', 'false');
  });

  it('M91 — a thumbs-DOWN POSTs feedback {label:"down"} (not just the up path)', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (String(url).includes('/ask/feedback')) return Promise.resolve({ label: 'down' });
      return Promise.resolve({ answer: 'because X' });
    });
    render(<AskThread traceId="t1" spans={tree} />);
    await ask('why?');
    await screen.findByTestId('thread-turn-assistant');
    const down = screen.getByRole('button', { name: /bad answer/i });
    await userEvent.click(down);
    expect(down).toHaveAttribute('aria-pressed', 'true');
    const post = mockCloudFetch.mock.calls.find(
      (c) => String(c[0]).includes('/ask/feedback') && (c[1] as { method?: string })?.method === 'POST',
    );
    expect(post).toBeTruthy();
    expect(JSON.parse((post![1] as { body: string }).body).label).toBe('down');
  });

  it('M91 — switching up→down POSTs the new label and moves the pressed state (no stale vote)', async () => {
    mockCloudFetch.mockImplementation((url: string, opts?: { method?: string }) =>
      String(url).includes('/ask/feedback')
        ? Promise.resolve(opts?.method === 'DELETE' ? undefined : { label: 'ok' })
        : Promise.resolve({ answer: 'because X' }),
    );
    render(<AskThread traceId="t1" spans={tree} />);
    await ask('why?');
    await screen.findByTestId('thread-turn-assistant');
    const up = screen.getByRole('button', { name: /good answer/i });
    const down = screen.getByRole('button', { name: /bad answer/i });
    await userEvent.click(up); // up
    expect(up).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(down); // switch to down
    expect(down).toHaveAttribute('aria-pressed', 'true');
    expect(up).toHaveAttribute('aria-pressed', 'false'); // no stale up vote
    // the LAST feedback POST carries the new label 'down'
    const posts = mockCloudFetch.mock.calls.filter(
      (c) => String(c[0]).includes('/ask/feedback') && (c[1] as { method?: string })?.method === 'POST',
    );
    expect(JSON.parse((posts.at(-1)![1] as { body: string }).body).label).toBe('down');
  });

  it('M91 — a failed clear (DELETE) reverts to the PRIOR label, not to no-vote (review H-1)', async () => {
    // vote up succeeds; the retract DELETE fails → the UI must fall back to the prior 'up',
    // never show a cleared thumb that did not persist (no silent UI/DB divergence).
    mockCloudFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).includes('/ask/feedback')) {
        if (opts?.method === 'DELETE') return Promise.reject(new ApiError(502));
        return Promise.resolve({ label: 'up' });
      }
      return Promise.resolve({ answer: 'because X' });
    });
    render(<AskThread traceId="t1" spans={tree} />);
    await ask('why?');
    await screen.findByTestId('thread-turn-assistant');
    const up = screen.getByRole('button', { name: /good answer/i });
    await userEvent.click(up); // vote up (POST ok)
    expect(up).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(up); // click active thumb → clear via DELETE, which rejects
    expect(await screen.findByText(/could not save your feedback/i)).toBeInTheDocument();
    expect(up).toHaveAttribute('aria-pressed', 'true'); // reverted to the prior 'up', not cleared
  });
});
