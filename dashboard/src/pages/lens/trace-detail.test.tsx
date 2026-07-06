import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { userEvent } from '@testing-library/user-event';
import { within } from '@testing-library/react';
import { fireEvent, render, screen } from '@/test/render';

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
  computeBarLayout,
  computeTraceBounds,
  VIRTUALIZE_THRESHOLD,
} from './trace-detail';
import { ancestors } from './trace-detail/breadcrumb';
import { aggregateCost } from '@/lib/trace-layout';
import { formatCost, formatDate } from '@/lib/format';

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

  it('M55 — a span with a recorded input offers a Playground that reveals the replay editor', async () => {
    mockCloudFetch.mockResolvedValue(tree());
    render(<LensTraceDetail traceId="t1" />);
    const detail = await screen.findByTestId('span-detail');
    const btn = within(detail).getByRole('button', { name: /^playground$/i });
    expect(screen.queryByTestId('playground')).not.toBeInTheDocument(); // closed by default
    await userEvent.click(btn);
    expect(await screen.findByTestId('playground')).toBeInTheDocument(); // revealed on click
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
    // M57 T2.1 — durations render via formatDuration (no raw "885 ms" with a space)
    expect(within(detail).getByText('885ms')).toBeInTheDocument();
    expect(within(detail).queryByText('885 ms')).not.toBeInTheDocument();
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

  // M57 T5.1 — a successful fetch with no spans is an honest empty state, NOT
  // the "service unavailable" error (which is reserved for query.isError).
  it('shows an empty state (not the error alert) when the trace has no spans', async () => {
    mockCloudFetch.mockResolvedValue(null);
    render(<LensTraceDetail traceId="t1" />);
    expect(await screen.findByText('No spans in this trace')).toBeInTheDocument();
    expect(screen.queryByText('Could not load this trace')).not.toBeInTheDocument();
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

describe('computeBarLayout (M50 — pure waterfall bar layout)', () => {
  it('maps a span to left/width percent of the trace window', () => {
    // trace [1000,2000]; span covers the second half [1500,2000] → left 50, width 50
    expect(computeBarLayout('1500', '2000', 1000n, 2000n)).toEqual({ leftPct: 50, widthPct: 50, unbounded: false });
  });

  it('clamps an out-of-range span to [0,100] with left+width <= 100', () => {
    // span starts before trace start and ends after trace end
    const { leftPct, widthPct } = computeBarLayout('500', '3000', 1000n, 2000n);
    expect(leftPct).toBe(0);
    expect(leftPct + widthPct).toBeLessThanOrEqual(100);
    expect(widthPct).toBe(100);
  });

  it('renders zero width for a zero/negative-duration span', () => {
    expect(computeBarLayout('1500', '1500', 1000n, 2000n).widthPct).toBe(0);
    expect(computeBarLayout('1500', '1400', 1000n, 2000n).widthPct).toBe(0); // clock-skewed end < start
  });

  it('marks a missing-end span unbounded with zero width', () => {
    expect(computeBarLayout('1500', undefined, 1000n, 2000n)).toEqual({ leftPct: 50, widthPct: 0, unbounded: true });
  });

  it('guards a zero-duration trace window (no NaN/Infinity)', () => {
    const { leftPct, widthPct } = computeBarLayout('1000', '1000', 1000n, 1000n);
    expect(Number.isFinite(leftPct)).toBe(true);
    expect(Number.isFinite(widthPct)).toBe(true);
  });

  it('places overlapping/parallel siblings independently on the same window', () => {
    const a = computeBarLayout('1000', '1600', 1000n, 2000n); // 0–60%
    const b = computeBarLayout('1200', '1800', 1000n, 2000n); // 20–80% (overlaps a)
    expect(a).toEqual({ leftPct: 0, widthPct: 60, unbounded: false });
    expect(b).toEqual({ leftPct: 20, widthPct: 60, unbounded: false });
  });
});

describe('computeTraceBounds (M50 — min start / max end over all spans)', () => {
  it('takes the earliest start and latest end across the whole tree', () => {
    const root = {
      spanId: 'r', traceId: 't', name: 'r', startTimeUnixNano: '2000', endTimeUnixNano: '5000',
      children: [
        { spanId: 'a', traceId: 't', name: 'a', startTimeUnixNano: '1000', endTimeUnixNano: '4000' }, // earlier start
        { spanId: 'b', traceId: 't', name: 'b', startTimeUnixNano: '3000', endTimeUnixNano: '9000' }, // later end
      ],
    };
    expect(computeTraceBounds(root)).toEqual({ startNs: 1000n, endNs: 9000n });
  });

  it('falls back to a span start when its end is missing', () => {
    const root = { spanId: 'r', traceId: 't', name: 'r', startTimeUnixNano: '1000' }; // no end
    expect(computeTraceBounds(root)).toEqual({ startNs: 1000n, endNs: 1000n });
  });

  it('still counts a valid start when the end is unparseable (regression: no whole-span skip)', () => {
    const root = {
      spanId: 'r', traceId: 't', name: 'r', startTimeUnixNano: '2000', endTimeUnixNano: '3000',
      children: [
        // earliest start but a garbage end — its start must still lower the min bound
        { spanId: 'a', traceId: 't', name: 'a', startTimeUnixNano: '1000', endTimeUnixNano: 'not-a-number' },
      ],
    };
    expect(computeTraceBounds(root)).toEqual({ startNs: 1000n, endNs: 3000n });
  });
});

describe('LensTraceDetail — M50 waterfall timeline', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a timeline bar for every visible span', async () => {
    mockCloudFetch.mockResolvedValue(tree()); // root + 1 child = 2 spans
    render(<LensTraceDetail traceId="t1" />);
    await screen.findByTestId('span-tree');
    expect(screen.getAllByTestId('span-bar')).toHaveLength(2);
  });

  it('positions a bar per computeBarLayout (child at the trace midpoint → left ~50%)', async () => {
    mockCloudFetch.mockResolvedValue({
      spanId: 'root', traceId: 't1', name: 'root', startTimeUnixNano: '1000', endTimeUnixNano: '2000',
      children: [
        { spanId: 'mid', traceId: 't1', parentSpanId: 'root', name: 'mid', startTimeUnixNano: '1500', endTimeUnixNano: '2000' },
      ],
    });
    render(<LensTraceDetail traceId="t1" />);
    await screen.findByTestId('span-tree');
    const bars = screen.getAllByTestId('span-bar');
    // bars[0] = root (left 0%), bars[1] = child at midpoint (left 50%)
    expect(bars[1].style.left).toBe('50%');
  });

  it('clicking a timeline bar selects the same span the tree row would (shared row selection)', async () => {
    mockCloudFetch.mockResolvedValue(tree());
    render(<LensTraceDetail traceId="t1" />);
    await screen.findByTestId('span-tree');
    // bars[0] = root, bars[1] = the child span's bar; clicking it bubbles to the row select button.
    await userEvent.click(screen.getAllByTestId('span-bar')[1]);
    const detail = screen.getByTestId('span-detail');
    expect(within(detail).getByText('claude-haiku-4-5-20251001')).toBeInTheDocument();
  });

  it('marks an errored span bar', async () => {
    mockCloudFetch.mockResolvedValue({
      spanId: 'root', traceId: 't1', name: 'root', startTimeUnixNano: '1000', endTimeUnixNano: '2000', statusCode: '0',
      children: [
        { spanId: 'boom', traceId: 't1', parentSpanId: 'root', name: 'boom', startTimeUnixNano: '1000', endTimeUnixNano: '2000', statusCode: '2' },
      ],
    });
    render(<LensTraceDetail traceId="t1" />);
    await screen.findByTestId('span-tree');
    const errorBars = screen.getAllByTestId('span-bar').filter((b) => b.getAttribute('data-error') === 'true');
    expect(errorBars).toHaveLength(1);
  });

  it('marks a missing-end span bar as unbounded', async () => {
    mockCloudFetch.mockResolvedValue({
      spanId: 'root', traceId: 't1', name: 'root', startTimeUnixNano: '1000', endTimeUnixNano: '2000',
      children: [
        { spanId: 'live', traceId: 't1', parentSpanId: 'root', name: 'live', startTimeUnixNano: '1500' }, // no end
      ],
    });
    render(<LensTraceDetail traceId="t1" />);
    await screen.findByTestId('span-tree');
    const unbounded = screen.getAllByTestId('span-bar').filter((b) => b.getAttribute('data-unbounded') === 'true');
    expect(unbounded).toHaveLength(1);
  });
});

// ---- M58 Phase 0 — URL selection store + breadcrumb + keyboard next/prev span ----

/**
 * A 3-level fixture (root s0 → s1 → s3) with a sibling s2 and a second leaf s4 so we can
 * exercise the ancestor chain and next/prev visible-order navigation.
 * Visible depth-first order: s0, s1, s3, s2, s4.
 */
function navTree() {
  return {
    spanId: 's0',
    traceId: 't1',
    name: 'root.span',
    startTimeUnixNano: '1000',
    endTimeUnixNano: '5000',
    children: [
      {
        spanId: 's1',
        traceId: 't1',
        parentSpanId: 's0',
        name: 'middle.span',
        startTimeUnixNano: '1000',
        endTimeUnixNano: '3000',
        children: [
          {
            spanId: 's3',
            traceId: 't1',
            parentSpanId: 's1',
            name: 'leaf.three',
            model: 'claude-haiku-4-5-20251001',
            startTimeUnixNano: '1200',
            endTimeUnixNano: '2000',
          },
        ],
      },
      {
        spanId: 's2',
        traceId: 't1',
        parentSpanId: 's0',
        name: 'sibling.two',
        startTimeUnixNano: '3000',
        endTimeUnixNano: '4000',
        children: [
          {
            spanId: 's4',
            traceId: 't1',
            parentSpanId: 's2',
            name: 'leaf.four',
            startTimeUnixNano: '3200',
            endTimeUnixNano: '3800',
          },
        ],
      },
    ],
  };
}

describe('ancestors (M58 P0 — pure ancestor chain)', () => {
  it('returns root..selected for a nested span', () => {
    const root = navTree();
    expect(ancestors(root, 's3').map((n) => n.spanId)).toEqual(['s0', 's1', 's3']);
  });

  it('returns [root] for the root span itself', () => {
    const root = navTree();
    expect(ancestors(root, 's0').map((n) => n.spanId)).toEqual(['s0']);
  });

  it('returns [] when the span is not in the tree', () => {
    const root = navTree();
    expect(ancestors(root, 'nope')).toEqual([]);
  });
});

describe('LensTraceDetail — M58 P0 URL selection + breadcrumb + kbd nav', () => {
  beforeEach(() => vi.clearAllMocks());

  it('?spanId=s3 selects span s3 (detail pane shows its content)', async () => {
    mockCloudFetch.mockResolvedValue(navTree());
    render(<LensTraceDetail traceId="t1" />, { initialEntries: ['/?spanId=s3'] });
    const detail = await screen.findByTestId('span-detail');
    expect(within(detail).getByText('leaf.three')).toBeInTheDocument();
    expect(within(detail).getByText('claude-haiku-4-5-20251001')).toBeInTheDocument();
  });

  it('?spanId=UNKNOWN falls back to root without crashing', async () => {
    mockCloudFetch.mockResolvedValue(navTree());
    render(<LensTraceDetail traceId="t1" />, { initialEntries: ['/?spanId=UNKNOWN'] });
    const detail = await screen.findByTestId('span-detail');
    // no error/crash text, and the root span renders
    expect(within(detail).getByText('root.span')).toBeInTheDocument();
    expect(screen.queryByText(/could not load this trace/i)).not.toBeInTheDocument();
  });

  it('breadcrumb renders the ancestor chain root→…→selected in order', async () => {
    mockCloudFetch.mockResolvedValue(navTree());
    render(<LensTraceDetail traceId="t1" />, { initialEntries: ['/?spanId=s3'] });
    const crumbs = await screen.findByTestId('trace-breadcrumb');
    const names = within(crumbs)
      .getAllByTestId('breadcrumb-crumb')
      .map((el) => el.textContent);
    expect(names).toEqual(['root.span', 'middle.span', 'leaf.three']);
  });

  it('clicking a breadcrumb crumb selects that ancestor span', async () => {
    mockCloudFetch.mockResolvedValue(navTree());
    render(<LensTraceDetail traceId="t1" />, { initialEntries: ['/?spanId=s3'] });
    const crumbs = await screen.findByTestId('trace-breadcrumb');
    await userEvent.click(within(crumbs).getByRole('button', { name: 'middle.span' }));
    const detail = screen.getByTestId('span-detail');
    expect(within(detail).getByText('middle.span')).toBeInTheDocument();
  });

  it('pressing "]" selects the next visible span and updates the URL', async () => {
    mockCloudFetch.mockResolvedValue(navTree());
    render(<LensTraceDetail traceId="t1" />, { initialEntries: ['/?spanId=s0'] });
    await screen.findByTestId('span-detail');
    fireEvent.keyDown(window, { key: ']' }); // s0 → next visible is s1
    const detail = await screen.findByTestId('span-detail');
    expect(within(detail).getByText('middle.span')).toBeInTheDocument();
    // the URL is the source of truth: the breadcrumb now ends at the newly selected span
    const crumbs = screen.getByTestId('trace-breadcrumb');
    const last = within(crumbs).getAllByTestId('breadcrumb-crumb').at(-1);
    expect(last?.textContent).toBe('middle.span');
  });

  it('"]" advances through visible depth-first order and rewrites spanId in the URL', async () => {
    mockCloudFetch.mockResolvedValue(navTree());
    // start at s1; visible order is s0,s1,s3,s2,s4 → next after s1 is s3
    render(<LensTraceDetail traceId="t1" />, { initialEntries: ['/?spanId=s1'] });
    await screen.findByTestId('span-detail');
    fireEvent.keyDown(window, { key: ']' });
    const detail = await screen.findByTestId('span-detail');
    expect(within(detail).getByText('leaf.three')).toBeInTheDocument();
    // the deep-link is the source of truth: the breadcrumb now ends at s3
    const crumbs = screen.getByTestId('trace-breadcrumb');
    const last = within(crumbs).getAllByTestId('breadcrumb-crumb').at(-1);
    expect(last?.textContent).toBe('leaf.three');
  });

  it('"[" selects the previous visible span', async () => {
    mockCloudFetch.mockResolvedValue(navTree());
    // start at s3; visible order s0,s1,s3,... → prev is s1
    render(<LensTraceDetail traceId="t1" />, { initialEntries: ['/?spanId=s3'] });
    await screen.findByTestId('span-detail');
    fireEvent.keyDown(window, { key: '[' });
    const detail = await screen.findByTestId('span-detail');
    expect(within(detail).getByText('middle.span')).toBeInTheDocument();
  });

  it('"[" at the root is a no-op (no wrap)', async () => {
    mockCloudFetch.mockResolvedValue(navTree());
    render(<LensTraceDetail traceId="t1" />, { initialEntries: ['/?spanId=s0'] });
    await screen.findByTestId('span-detail');
    fireEvent.keyDown(window, { key: '[' });
    const detail = await screen.findByTestId('span-detail');
    expect(within(detail).getByText('root.span')).toBeInTheDocument(); // still root
  });

  it('"]" at the last visible span is a no-op (no wrap)', async () => {
    mockCloudFetch.mockResolvedValue(navTree());
    // last in visible order is s4
    render(<LensTraceDetail traceId="t1" />, { initialEntries: ['/?spanId=s4'] });
    await screen.findByTestId('span-detail');
    fireEvent.keyDown(window, { key: ']' });
    const detail = await screen.findByTestId('span-detail');
    expect(within(detail).getByText('leaf.four')).toBeInTheDocument(); // still s4
  });
});

// ---- M58 Phase 1 (T1.2) — polished waterfall view ----

// A ~2s trace with real epoch-ns timestamps (so absolute-time labels are valid dates), an error
// child, and per-span costs so the ∑ parent-cost badge has something to sum. Base epoch:
// 1_700_000_000 s → 1_700_000_000_000_000_000 ns.
const WF_BASE_NS = 1_700_000_000_000_000_000n;
function waterfallTree() {
  const at = (secOffset: number) => (WF_BASE_NS + BigInt(secOffset) * 1_000_000_000n).toString();
  return {
    spanId: 'w0',
    traceId: 't1',
    name: 'root.request',
    startTimeUnixNano: at(0),
    endTimeUnixNano: at(2), // 2s trace window
    statusCode: '0',
    costUsd: 0.01,
    children: [
      {
        spanId: 'w1',
        traceId: 't1',
        parentSpanId: 'w0',
        name: 'llm.call',
        startTimeUnixNano: at(0),
        endTimeUnixNano: at(1),
        model: 'claude-haiku-4-5-20251001',
        statusCode: '0',
        costUsd: 0.02,
      },
      {
        spanId: 'w2',
        traceId: 't1',
        parentSpanId: 'w0',
        name: 'tool.boom',
        startTimeUnixNano: at(1),
        endTimeUnixNano: at(2),
        statusCode: '2', // error
      },
    ],
  };
}

describe('LensTraceDetail — M58 P1.2 waterfall', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a nice-interval time axis with second-shaped tick labels', async () => {
    mockCloudFetch.mockResolvedValue(waterfallTree());
    render(<LensTraceDetail traceId="t1" />);
    const wf = await screen.findByTestId('waterfall');
    // A 2s window at ≥70px ticks yields 0s / 1s / 2s (or a subset) — assert the seconds labels appear.
    expect(within(wf).getByText('1s')).toBeInTheDocument();
    expect(within(wf).getByText('2s')).toBeInTheDocument();
  });

  it('hovering the lane shows a needle with a formatDate-shaped absolute time', async () => {
    mockCloudFetch.mockResolvedValue(waterfallTree());
    render(<LensTraceDetail traceId="t1" />);
    const lane = await screen.findByTestId('waterfall-lane');
    // No needle before hover.
    expect(screen.queryByTestId('waterfall-needle')).not.toBeInTheDocument();
    fireEvent.mouseMove(lane, { clientX: 0 });
    const needle = await screen.findByTestId('waterfall-needle');
    // At clientX 0 (jsdom rect left 0) the needle sits at the trace start → its label is the
    // absolute datetime of the start, exactly as formatDate renders it.
    const startIso = new Date(Number(WF_BASE_NS / 1_000_000n)).toISOString();
    expect(needle.textContent ?? '').toContain(formatDate(startIso, 'datetime'));
  });

  it('an error span renders a destructive waterfall bar', async () => {
    mockCloudFetch.mockResolvedValue(waterfallTree());
    render(<LensTraceDetail traceId="t1" />);
    const wf = await screen.findByTestId('waterfall');
    const errorBars = within(wf)
      .getAllByTestId('waterfall-bar')
      .filter((b) => b.getAttribute('data-error') === 'true');
    expect(errorBars).toHaveLength(1);
    expect(errorBars[0].className).toMatch(/destructive/);
  });

  it('the URL-selected span renders with a ring on its waterfall bar', async () => {
    mockCloudFetch.mockResolvedValue(waterfallTree());
    render(<LensTraceDetail traceId="t1" />, { initialEntries: ['/?spanId=w1'] });
    const wf = await screen.findByTestId('waterfall');
    const selected = within(wf)
      .getAllByTestId('waterfall-bar')
      .filter((b) => b.getAttribute('data-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].className).toMatch(/ring/);
  });

  it('a parent row shows its ∑ aggregated cost', async () => {
    const root = waterfallTree();
    mockCloudFetch.mockResolvedValue(root);
    render(<LensTraceDetail traceId="t1" />);
    const wf = await screen.findByTestId('waterfall');
    // root ∑ = 0.01 (own) + 0.02 (w1) + 0 (w2) = 0.03.
    const total = aggregateCost(root as never); // 0.03
    expect(within(wf).getByText(new RegExp(`∑\\s*${formatCost(total).replace('$', '\\$')}`))).toBeInTheDocument();
  });
});
