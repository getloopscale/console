import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { userEvent } from '@testing-library/user-event';
import { within } from '@testing-library/react';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensTraceDetail, durationMs, prettyValue, asChat } from './trace-detail';

// jsdom has no scrollIntoView — stub it so the scroll-to-selected effect can be observed.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// A 2-level tree mirroring theo-lens GET /v1/traces/:id (root span carries children[]).
function tree(overrides: Record<string, unknown> = {}) {
  return {
    spanId: 'root',
    traceId: 't1',
    name: 'claude_code.interaction',
    startTimeUnixNano: '1000000000',
    endTimeUnixNano: '1016540000000',
    kind: '1',
    statusCode: '0',
    inputValue: '<REDACTED>',
    attributes: { 'span.type': 'interaction', 'user.email': 'x@y.z' },
    children: [
      {
        spanId: 'child',
        traceId: 't1',
        parentSpanId: 'root',
        name: 'claude_code.llm_request',
        startTimeUnixNano: '1000000000',
        endTimeUnixNano: '1000955000000',
        model: 'claude-haiku-4-5-20251001',
        provider: 'anthropic',
        inputTokens: 501,
        outputTokens: 13,
        ttftMs: 885,
        outputValue: '{"answer":"hi"}',
        attributes: { stop_reason: 'end_turn' },
        events: [{ name: 'gen_ai.request.attempt', attributes: { attempt: '1' } }],
      },
    ],
    ...overrides,
  };
}

describe('LensTraceDetail — span tree', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the span tree from a nested fixture', async () => {
    mockCloudFetch.mockResolvedValue(tree());
    render(<LensTraceDetail traceId="t1" />);
    const treeEl = await screen.findByTestId('span-tree');
    expect(within(treeEl).getByText('claude_code.interaction')).toBeInTheDocument();
    expect(within(treeEl).getByText('claude_code.llm_request')).toBeInTheDocument();
    expect(mockCloudFetch).toHaveBeenCalledWith('/v1/dashboard/lens/traces/t1');
  });

  it('selecting a span marks it active and shows its detail', async () => {
    mockCloudFetch.mockResolvedValue(tree());
    render(<LensTraceDetail traceId="t1" />);
    const child = await screen.findByRole('button', { name: /claude_code\.llm_request/i });
    await userEvent.click(child);
    expect(child).toHaveAttribute('aria-current', 'true');
    const detail = screen.getByTestId('span-detail');
    expect(within(detail).getByText('claude-haiku-4-5-20251001')).toBeInTheDocument();
  });
});

describe('LensTraceDetail — selected-span detail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows redacted-labelled input for the root span by default', async () => {
    mockCloudFetch.mockResolvedValue(tree());
    render(<LensTraceDetail traceId="t1" />);
    const detail = await screen.findByTestId('span-detail');
    expect(within(detail).getByText(/redacted/i)).toBeInTheDocument();
  });

  it('shows pretty-printed JSON output for the selected span', async () => {
    mockCloudFetch.mockResolvedValue(tree());
    render(<LensTraceDetail traceId="t1" />);
    await userEvent.click(await screen.findByRole('button', { name: /claude_code\.llm_request/i }));
    const detail = screen.getByTestId('span-detail');
    expect(within(detail).getByText(/"answer": "hi"/)).toBeInTheDocument();
  });

  it('shows attributes, events and model/token metadata for the selected span', async () => {
    mockCloudFetch.mockResolvedValue(tree());
    render(<LensTraceDetail traceId="t1" />);
    await userEvent.click(await screen.findByRole('button', { name: /claude_code\.llm_request/i }));
    const detail = screen.getByTestId('span-detail');
    expect(within(detail).getByText('claude-haiku-4-5-20251001')).toBeInTheDocument();
    expect(within(detail).getByText(/501/)).toBeInTheDocument();
    expect(within(detail).getByText('stop_reason')).toBeInTheDocument();
    expect(within(detail).getByText('gen_ai.request.attempt')).toBeInTheDocument();
  });

  it('truncates oversized output and show-more reveals the full content', async () => {
    const big = 'x'.repeat(20000);
    mockCloudFetch.mockResolvedValue(tree({ inputValue: undefined, outputValue: big, children: [] }));
    render(<LensTraceDetail traceId="t1" />);
    const out = await screen.findByTestId('span-output');
    expect((out.textContent ?? '').length).toBeLessThan(big.length); // truncated
    await userEvent.click(screen.getByRole('button', { name: /show more/i }));
    expect((screen.getByTestId('span-output').textContent ?? '').length).toBe(big.length); // fully revealed
    expect(screen.getByRole('button', { name: /show less/i })).toBeInTheDocument();
  });

  it('role-renders a chat-message array instead of raw JSON', async () => {
    const chat = JSON.stringify([
      { role: 'user', content: 'why did it fail?' },
      { role: 'assistant', content: 'the tool timed out' },
    ]);
    mockCloudFetch.mockResolvedValue(tree({ inputValue: chat, children: [] }));
    render(<LensTraceDetail traceId="t1" />);
    const detail = await screen.findByTestId('span-detail');
    expect(within(detail).getByTestId('chat-view')).toBeInTheDocument();
    expect(within(detail).getByText('user')).toBeInTheDocument();
    expect(within(detail).getByText('why did it fail?')).toBeInTheDocument();
    expect(within(detail).getByText('assistant')).toBeInTheDocument();
  });

  it('does not use dangerouslySetInnerHTML (XSS guard)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/pages/lens/trace-detail.tsx'), 'utf8');
    // No JSX USE of the escape hatch (a doc-comment mention is fine — the guard is against use).
    expect(src).not.toMatch(/dangerouslySetInnerHTML\s*=/);
  });
});

describe('LensTraceDetail — tree interaction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('collapses and expands a subtree via the toggle', async () => {
    mockCloudFetch.mockResolvedValue(tree());
    render(<LensTraceDetail traceId="t1" />);
    await screen.findByTestId('span-tree');
    // child visible initially
    expect(screen.getByRole('button', { name: /claude_code\.llm_request/i })).toBeInTheDocument();
    // collapse the root → child hidden
    await userEvent.click(screen.getByRole('button', { name: /collapse claude_code\.interaction/i }));
    expect(screen.queryByRole('button', { name: /claude_code\.llm_request/i })).not.toBeInTheDocument();
    // expand → child back
    await userEvent.click(screen.getByRole('button', { name: /expand claude_code\.interaction/i }));
    expect(screen.getByRole('button', { name: /claude_code\.llm_request/i })).toBeInTheDocument();
  });

  it('scrolls the selected span into view on selection', async () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView');
    mockCloudFetch.mockResolvedValue(tree());
    render(<LensTraceDetail traceId="t1" />);
    await userEvent.click(await screen.findByRole('button', { name: /claude_code\.llm_request/i }));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('trace-detail pure helpers', () => {
  it('durationMs computes ms and guards missing/skewed/malformed timestamps', () => {
    expect(durationMs({ startTimeUnixNano: '1000000000', endTimeUnixNano: '1002000000' })).toBe(2);
    expect(durationMs({ startTimeUnixNano: undefined, endTimeUnixNano: '2' })).toBeNull();
    expect(durationMs({ startTimeUnixNano: '5000000000', endTimeUnixNano: '1000000000' })).toBeNull(); // skew
    expect(durationMs({ startTimeUnixNano: 'not-a-number', endTimeUnixNano: '2' })).toBeNull();
  });

  it('prettyValue pretty-prints JSON and leaves non-JSON raw', () => {
    expect(prettyValue('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyValue('plain text')).toBe('plain text');
  });

  it('asChat detects chat-message arrays and rejects everything else', () => {
    expect(asChat('[{"role":"user","content":"hi"}]')).toEqual([{ role: 'user', content: 'hi' }]);
    expect(asChat('{"a":1}')).toBeNull();
    expect(asChat('[]')).toBeNull();
    expect(asChat('[{"foo":1}]')).toBeNull();
    expect(asChat('not json')).toBeNull();
  });
});

describe('LensTraceDetail — resilience', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows an error alert when the tree fails to load', async () => {
    mockCloudFetch.mockRejectedValue(new Error('boom'));
    render(<LensTraceDetail traceId="t1" />);
    expect(await screen.findByText(/could not load this trace/i)).toBeInTheDocument();
  });

  it('handles an empty/childless trace without crashing', async () => {
    mockCloudFetch.mockResolvedValue(tree({ children: [], inputValue: undefined, attributes: {} }));
    render(<LensTraceDetail traceId="t1" />);
    const treeEl = await screen.findByTestId('span-tree');
    expect(within(treeEl).getByText('claude_code.interaction')).toBeInTheDocument();
  });
});
