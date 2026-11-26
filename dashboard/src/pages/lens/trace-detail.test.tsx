import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { within } from '@testing-library/react';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

// react-resizable-panels needs a real ResizeObserver + measured sizes; mock it at the boundary so we
// test OUR wiring (a tree Panel, a detail Panel, a resize handle), not the library. The drag is the
// library's contract, verified live in the browser (M48 DoD live check).
vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children }: { children: React.ReactNode }) => <div data-testid="panel-group">{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelResizeHandle: (props: Record<string, unknown>) => <div role="separator" {...props} />,
}));

import { LensTraceDetail } from './trace-detail/index';
import { durationMs, prettyValue, asChat, computeBarLayout } from './trace-detail/helpers';
import { ancestors } from './trace-detail/breadcrumb';

/**
 * M8 — the trace-detail integration suite (consumer-owned behavior). The trace-native components
 * (SpanTree, SpanWaterfall, TraceTranscript, SpanGraph, AttributesTable, IOCards) moved to
 * `@getloopscale/ui`; their component-level tests live in the design system's own suite. What STAYS here is
 * the integration the lib never owns: URL-driven selection, the Tree ⇄ Transcript ⇄ Graph view toggle,
 * the breadcrumb, keyboard next/prev, fetch error/empty states, the panel composition, the trace
 * summary header, and the lens-specific SpanDetail surfaces (evaluations / cost / IO wiring).
 */

// jsdom has no scrollIntoView — stub it so any scroll-to-selected effect can run.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

/** A 2-level tree mirroring looptrace GET /v1/traces/:id (root span carries children[]). */
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
        statusCode: '0',
        attributes: { stop_reason: 'end_turn' },
        events: [{ name: 'gen_ai.request.attempt', attributes: { attempt: '1' } }],
      },
    ],
    ...overrides,
  };
}

/** Build a wide tree with `n` children under the root (to exercise the virtualization threshold). */
function wideTree(n: number) {
  return {
    spanId: 'root',
    traceId: 't1',
    name: 'root.span',
    startTimeUnixNano: '1000000000',
    endTimeUnixNano: '2000000000',
    children: Array.from({ length: n }, (_, i) => ({
      spanId: `c${i}`,
      traceId: 't1',
      parentSpanId: 'root',
      name: `child.${i}`,
      startTimeUnixNano: '1000000000',
      endTimeUnixNano: '1500000000',
    })),
  };
}

function mockTree(data: unknown) {
  mockCloudFetch.mockImplementation((path: string) => {
    if (typeof path === 'string' && path.includes('/enqueue-for-labeling')) return Promise.resolve({});
    return Promise.resolve(data);
  });
}

async function renderDetail(initialEntries: string[] = ['/observability/traces/t1']) {
  const result = render(<LensTraceDetail traceId="t1" />, { initialEntries });
  // let the react-query fetch resolve
  await screen.findByTestId('trace-summary');
  return result;
}

beforeEach(() => {
  mockCloudFetch.mockReset();
});

describe('LensTraceDetail — composition + summary', () => {
  it('test_renders_trace_summary_and_span_tree', async () => {
    mockTree(tree());
    await renderDetail();
    expect(screen.getByTestId('trace-summary')).toBeInTheDocument();
    // the kit SpanTree renders an ARIA tree with the span names (scoped — names also appear in the waterfall)
    const treeEl = screen.getByRole('tree');
    expect(within(treeEl).getByText('claude_code.interaction')).toBeInTheDocument();
    expect(within(treeEl).getByText('claude_code.llm_request')).toBeInTheDocument();
  });

  it('test_renders_the_waterfall_lane', async () => {
    mockTree(tree());
    const { container } = await renderDetail();
    expect(container.querySelector('[data-slot="span-waterfall"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="span-waterfall-row"]').length).toBeGreaterThan(0);
  });

  it('test_renders_the_selected_span_detail_with_lens_surfaces', async () => {
    mockTree(tree());
    await renderDetail();
    const detail = screen.getByTestId('span-detail');
    // lens-specific: the labeling-queue enqueue affordance stays in the consumer
    expect(within(detail).getByRole('button', { name: /labeling queue/i })).toBeInTheDocument();
    // IO wiring: the kit IOCards renders the input section (root carries a REDACTED input value)
    expect(within(detail).getByTestId('span-input')).toBeInTheDocument();
  });
});

describe('LensTraceDetail — URL-driven selection (consumer-owned)', () => {
  it('test_spanId_query_selects_that_span', async () => {
    mockTree(tree());
    await renderDetail(['/observability/traces/t1?spanId=child']);
    // the child span's detail is shown (its model badge is a detail-only signal)
    const detail = screen.getByTestId('span-detail');
    expect(within(detail).getByText('anthropic')).toBeInTheDocument();
  });

  it('test_unknown_spanId_falls_back_to_root', async () => {
    mockTree(tree());
    await renderDetail(['/observability/traces/t1?spanId=NOPE']);
    // root has no model badge; the detail shows the root name, not a crash
    const detail = screen.getByTestId('span-detail');
    expect(within(detail).getByText('claude_code.interaction')).toBeInTheDocument();
  });

  it('test_clicking_a_span_updates_selection', async () => {
    const user = userEvent.setup();
    mockTree(tree());
    await renderDetail();
    // click the child span inside the tree (its name also appears in the waterfall)
    const treeEl = screen.getByRole('tree');
    await user.click(within(treeEl).getByText('claude_code.llm_request'));
    const detail = screen.getByTestId('span-detail');
    expect(within(detail).getByText('anthropic')).toBeInTheDocument();
  });
});

describe('LensTraceDetail — view toggle (Tree ⇄ Transcript ⇄ Graph)', () => {
  it('test_transcript_view_renders_the_kit_transcript', async () => {
    const user = userEvent.setup();
    mockTree(tree());
    const { container } = await renderDetail();
    await user.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(container.querySelector('[data-slot="trace-transcript"]')).toBeInTheDocument();
  });

  it('test_graph_view_renders_the_kit_graph', async () => {
    const user = userEvent.setup();
    mockTree(tree());
    await renderDetail();
    await user.click(screen.getByRole('button', { name: 'Graph' }));
    expect(screen.getByRole('group', { name: /agent graph/i })).toBeInTheDocument();
  });

  it('test_honors_view_query_on_first_render', async () => {
    mockTree(tree());
    const { container } = await renderDetail(['/observability/traces/t1?view=transcript']);
    expect(container.querySelector('[data-slot="trace-transcript"]')).toBeInTheDocument();
  });
});

describe('LensTraceDetail — breadcrumb (consumer-owned)', () => {
  it('test_renders_breadcrumb_of_the_selected_ancestor_chain', async () => {
    mockTree(tree());
    await renderDetail(['/observability/traces/t1?spanId=child']);
    const crumb = screen.getByTestId('trace-breadcrumb');
    expect(within(crumb).getByText('claude_code.llm_request')).toBeInTheDocument();
  });
});

describe('LensTraceDetail — scale + resilience', () => {
  it('test_large_trace_takes_the_virtualized_path', async () => {
    mockTree(wideTree(250));
    const { container } = await renderDetail();
    expect(container.querySelector('[data-slot="span-tree-virtual"]')).toBeInTheDocument();
  });

  it('test_fetch_error_shows_an_alert', async () => {
    mockCloudFetch.mockRejectedValue(new Error('boom'));
    render(<LensTraceDetail traceId="t1" />, { initialEntries: ['/observability/traces/t1'] });
    expect(await screen.findByText(/could not load this trace/i)).toBeInTheDocument();
  });
});

describe('trace-detail pure helpers (kept in the consumer)', () => {
  it('durationMs computes ms & guards clock-skew', () => {
    expect(durationMs({ startTimeUnixNano: '0', endTimeUnixNano: '1000000' })).toBe(1);
    expect(durationMs({ startTimeUnixNano: '2000000', endTimeUnixNano: '1000000' })).toBeNull();
  });

  it('prettyValue pretty-prints JSON, leaves non-JSON raw', () => {
    expect(prettyValue('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyValue('hello')).toBe('hello');
  });

  it('asChat detects chat arrays', () => {
    expect(asChat('[{"role":"user","content":"x"}]')).not.toBeNull();
    expect(asChat('{"a":1}')).toBeNull();
  });

  it('computeBarLayout clamps to [0,100] and flags unbounded', () => {
    const l = computeBarLayout('150', undefined, 0n, 100n);
    expect(l.unbounded).toBe(true);
    expect(l.leftPct).toBeLessThanOrEqual(100);
  });

  it('ancestors returns the root..selected chain, or [] for a stale span', () => {
    const root = { spanId: 'r', name: 'r', children: [{ spanId: 'a', name: 'a' }] } as never;
    expect(ancestors(root, 'a').map((n: { spanId: string }) => n.spanId)).toEqual(['r', 'a']);
    expect(ancestors(root, 'ghost')).toEqual([]);
  });
});
