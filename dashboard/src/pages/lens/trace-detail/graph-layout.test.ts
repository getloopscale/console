import { describe, it, expect } from 'vitest';

import type { TraceSpanNode } from '@/lib/trace-layout';
import { buildTraceGraph, deriveSpanKind, GRAPH_NODE_CAP, type SpanKind } from './graph-layout';

function span(over: Partial<TraceSpanNode> & { spanId: string }): TraceSpanNode {
  return { traceId: 't', name: over.spanId, ...over };
}

// A small 3-level tree: root → [research(llm), tools(chain) → [search(tool)]]
const ROOT: TraceSpanNode = span({
  spanId: 'root',
  name: 'agent-run',
  children: [
    span({ spanId: 'research', parentSpanId: 'root', model: 'gpt-4o' }),
    span({
      spanId: 'tools',
      parentSpanId: 'root',
      children: [span({ spanId: 'search', parentSpanId: 'tools', attributes: { 'gen_ai.tool.name': 'web_search' } })],
    }),
  ],
});

describe('M67 deriveSpanKind (ported precedence)', () => {
  const kind = (o: Partial<TraceSpanNode>): SpanKind => deriveSpanKind(span({ spanId: 'x', ...o }));
  it('test_deriveSpanKind_precedence', () => {
    expect(kind({ attributes: { 'gen_ai.tool.name': 'web_search' } })).toBe('tool'); // tool wins
    expect(kind({ attributes: { 'gen_ai.operation.name': 'execute_tool' } })).toBe('tool');
    expect(kind({ attributes: { 'gen_ai.operation.name': 'retrieve' } })).toBe('retriever');
    expect(kind({ attributes: { 'gen_ai.operation.name': 'embeddings' } })).toBe('embedding');
    expect(kind({ model: 'gpt-4o' })).toBe('llm'); // a model → llm
    expect(kind({ children: [span({ spanId: 'c' })] })).toBe('chain'); // childful, no other signal
    expect(kind({})).toBe('unknown'); // negative: no signal
  });
});

describe('M67 buildTraceGraph (pure, deterministic)', () => {
  it('test_buildTraceGraph_nodes_and_edges_from_tree', () => {
    const g = buildTraceGraph(ROOT);
    expect(g.nodes).toHaveLength(4); // root, research, tools, search
    expect(g.edges).toHaveLength(3); // one per non-root span
    expect(g.edges).toContainEqual(expect.objectContaining({ from: 'root', to: 'research' }));
    expect(g.edges).toContainEqual(expect.objectContaining({ from: 'tools', to: 'search' }));
    // deterministic depth: root=0, research/tools=1, search=2
    const byId = Object.fromEntries(g.nodes.map((n) => [n.spanId, n]));
    expect(byId['root'].depth).toBe(0);
    expect(byId['search'].depth).toBe(2);
    expect(byId['research'].kind).toBe('llm');
    expect(byId['search'].kind).toBe('tool');
  });

  it('test_buildTraceGraph_is_deterministic', () => {
    // re-running yields byte-identical layout (the DoD's "deterministic node placement")
    expect(buildTraceGraph(ROOT)).toEqual(buildTraceGraph(ROOT));
  });

  it('test_onPath_is_root_to_selected_chain', () => {
    const g = buildTraceGraph(ROOT, 'search');
    const onPath = new Set(g.nodes.filter((n) => n.onPath).map((n) => n.spanId));
    expect(onPath).toEqual(new Set(['root', 'tools', 'search'])); // the ancestor chain, not `research`
    expect(g.nodes.find((n) => n.spanId === 'search')!.selected).toBe(true);
    // the edges on that chain are flagged too
    expect(g.edges.find((e) => e.from === 'tools' && e.to === 'search')!.onPath).toBe(true);
    expect(g.edges.find((e) => e.from === 'root' && e.to === 'research')!.onPath).toBe(false);
  });

  it('test_onPath_defaults_to_root_deepest_leaf_when_no_selection', () => {
    const g = buildTraceGraph(ROOT); // no selection → root→deepest (search, depth 2)
    const onPath = new Set(g.nodes.filter((n) => n.onPath).map((n) => n.spanId));
    expect(onPath).toEqual(new Set(['root', 'tools', 'search']));
  });

  it('test_cycle_and_self_loop_are_guarded', () => {
    // negative: a self-loop + a back-edge must not infinite-loop; each span placed once.
    const looped: TraceSpanNode = span({
      spanId: 'root',
      children: [
        span({ spanId: 'a', parentSpanId: 'a' }), // self-loop → attaches to root, placed once
        span({ spanId: 'b', parentSpanId: 'root', children: [span({ spanId: 'c', parentSpanId: 'b' })] }),
      ],
    });
    const g = buildTraceGraph(looped);
    expect(g.nodes.map((n) => n.spanId).sort()).toEqual(['a', 'b', 'c', 'root']); // each once, no hang
  });

  it('test_missing_parent_attaches_to_root_not_dropped', () => {
    // negative: a span pointing at an absent parent → attached under root, never dropped.
    const orphaned: TraceSpanNode = span({
      spanId: 'root',
      children: [span({ spanId: 'lost', parentSpanId: 'ghost-parent-not-in-tree' })],
    });
    const g = buildTraceGraph(orphaned);
    expect(g.nodes.map((n) => n.spanId).sort()).toEqual(['lost', 'root']);
    expect(g.edges).toContainEqual(expect.objectContaining({ from: 'root', to: 'lost' })); // re-parented to root
  });

  it('test_over_cap_returns_truncated', () => {
    const many: TraceSpanNode = span({
      spanId: 'root',
      children: Array.from({ length: GRAPH_NODE_CAP + 1 }, (_, i) => span({ spanId: `s${i}`, parentSpanId: 'root' })),
    });
    const g = buildTraceGraph(many);
    expect(g.truncated).toBe(true);
    expect(g.nodes).toHaveLength(0); // never renders an oversize canvas
    expect(g.count).toBe(GRAPH_NODE_CAP + 2); // root + N+1
  });

  it('test_single_span_trace_renders_root_only', () => {
    const g = buildTraceGraph(span({ spanId: 'solo' }));
    expect(g.nodes).toHaveLength(1);
    expect(g.edges).toHaveLength(0);
  });
});
