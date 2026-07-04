import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { userEvent } from '@testing-library/user-event';
import { within } from '@testing-library/react';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

// react-resizable-panels is a layout library that jsdom cannot lay out (it needs a real
// ResizeObserver + measured sizes); mock it at the boundary so we test OUR wiring (a tree Panel,
// a detail Panel, a resize handle), not the library. The drag behaviour is the library's contract
// and is verified live in the browser (M48 DoD live check).
vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children }: { children: React.ReactNode }) => <div data-testid="panel-group">{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelResizeHandle: (props: Record<string, unknown>) => <div role="separator" {...props} />,
}));

import {
  LensTraceDetail,
  durationMs,
  prettyValue,
  asChat,
  flattenVisible,
  VIRTUALIZE_THRESHOLD,
} from './trace-detail';

/** Build a wide tree with `n` children under the root (to exercise the virtualization threshold). */
function wideTree(n: number) {
  return {
    spanId: 'root',
    traceId: 't1',
    name: 'root.span',
    children: Array.from({ length: n }, (_, i) => ({
      spanId: `c${i}`,
      traceId: 't1',
      parentSpanId: 'root',
      name: `child.${i}`,
    })),
  };
}

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

  it('renders JSON output in a read-only CodeMirror viewer (M48)', async () => {
    mockCloudFetch.mockResolvedValue(tree());
    render(<LensTraceDetail traceId="t1" />);
    await userEvent.click(await screen.findByRole('button', { name: /claude_code\.llm_request/i }));
    const out = within(screen.getByTestId('span-detail')).getByTestId('span-output');
    // CodeMirror mounted (rich rendering) and carries the JSON content, read-only.
    const cm = out.querySelector('.cm-editor');
    expect(cm).toBeInTheDocument();
    expect(cm?.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false');
    expect(out.textContent ?? '').toContain('answer');
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

describe('LensTraceDetail — M48 scale + rich', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders plainly below the virtualization threshold (no regression)', async () => {
    mockCloudFetch.mockResolvedValue(tree());
    render(<LensTraceDetail traceId="t1" />);
    const treeEl = await screen.findByTestId('span-tree');
    expect(screen.queryByTestId('span-tree-virtual')).not.toBeInTheDocument(); // recursive path
    expect(within(treeEl).getByText('claude_code.interaction')).toBeInTheDocument();
  });

  it('takes the virtualized path above the threshold (small traces stay recursive)', async () => {
    mockCloudFetch.mockResolvedValue(wideTree(VIRTUALIZE_THRESHOLD + 20));
    render(<LensTraceDetail traceId="t1" />);
    // the branch switches to the react-virtual container. jsdom has no layout so it cannot render
    // the virtualized rows themselves (react-virtual needs measured sizes) — the row-level render is
    // verified live; the flatten/collapse feed of those rows is unit-tested by `flattenVisible` below.
    expect(await screen.findByTestId('span-tree-virtual')).toBeInTheDocument();
  });

  it('renders a resizable split with a drag handle', async () => {
    mockCloudFetch.mockResolvedValue(tree());
    render(<LensTraceDetail traceId="t1" />);
    await screen.findByTestId('span-tree');
    expect(screen.getByRole('separator', { name: /resize trace panels/i })).toBeInTheDocument();
  });

  it('shows an error badge for a span with a non-zero statusCode (M47 L5)', async () => {
    mockCloudFetch.mockResolvedValue(tree({ statusCode: '2', children: [] }));
    render(<LensTraceDetail traceId="t1" />);
    const treeEl = await screen.findByTestId('span-tree');
    expect(within(treeEl).getByText('error')).toBeInTheDocument();
  });

  it('renders every row even when spanId is duplicated in malformed data (M47 L4)', async () => {
    mockCloudFetch.mockResolvedValue({
      spanId: 'dup',
      traceId: 't1',
      name: 'root',
      children: [
        { spanId: 'dup', traceId: 't1', name: 'child.a' },
        { spanId: 'dup', traceId: 't1', name: 'child.b' },
      ],
    });
    render(<LensTraceDetail traceId="t1" />);
    const treeEl = await screen.findByTestId('span-tree');
    expect(within(treeEl).getByText('child.a')).toBeInTheDocument();
    expect(within(treeEl).getByText('child.b')).toBeInTheDocument();
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

  it('flattenVisible respects collapse and carries depth (the virtual path feed)', () => {
    const t = {
      spanId: 'a',
      traceId: 't',
      name: 'a',
      children: [{ spanId: 'b', traceId: 't', name: 'b', children: [{ spanId: 'c', traceId: 't', name: 'c' }] }],
    };
    const all = flattenVisible(t, new Set());
    expect(all.map((f) => f.node.spanId)).toEqual(['a', 'b', 'c']);
    expect(all.map((f) => f.depth)).toEqual([0, 1, 2]);
    // collapse 'b' → its descendant 'c' disappears
    const collapsed = flattenVisible(t, new Set(['b']));
    expect(collapsed.map((f) => f.node.spanId)).toEqual(['a', 'b']);
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
