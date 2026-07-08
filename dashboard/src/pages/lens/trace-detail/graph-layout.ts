import type { TraceSpanNode } from '@/lib/trace-layout';
import { flattenAll } from './helpers';

/**
 * M67 — the PURE, deterministic model for the Agent Graph tab. No I/O, no React: it derives each
 * span's semantic kind, lays the trace out as a layered node-edge graph (depth = distance from root,
 * order = index within depth), flags the root→selected execution path, and caps huge traces — all
 * unit-testable in isolation so `span-graph.tsx` stays a thin renderer (D1: pure-SVG layered layout,
 * NOT the installed force-graph — its physics layout is non-deterministic + untestable).
 */

/** Canonical span kinds — mirrors the theo-lens taxonomy (`packages/web/src/lib/span-kind.ts`). */
export type SpanKind = 'llm' | 'tool' | 'retriever' | 'embedding' | 'chain' | 'unknown';

const ERROR_STATUS = new Set(['2', 'ERROR', 'STATUS_CODE_ERROR']);
function isErrorStatus(code: string | undefined): boolean {
  return code != null && ERROR_STATUS.has(code);
}

function attr(span: TraceSpanNode, key: string): string | undefined {
  const a = span.attributes;
  if (a == null || typeof a !== 'object') return undefined;
  const v = (a as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Derive a span's semantic kind from signals already on the DTO (D2 — the `.kind` field is the raw
 * OTLP numeric, useless as agent/tool/LLM). PORTED faithfully from theo-lens
 * `packages/web/src/lib/span-kind.ts` `deriveKindFromSignals`: precedence
 * tool > retriever > embedding > llm > chain(has children) > unknown.
 */
export function deriveSpanKind(span: TraceSpanNode): SpanKind {
  const operationName = attr(span, 'gen_ai.operation.name');
  const toolName = attr(span, 'gen_ai.tool.name');
  const hasChildren = (span.children?.length ?? 0) > 0;
  if (toolName != null || operationName === 'execute_tool') return 'tool';
  if (operationName === 'retrieve' || operationName === 'search') return 'retriever';
  if (operationName === 'embeddings' || operationName === 'embedding') return 'embedding';
  if (operationName === 'chat' || operationName === 'text_completion' || span.model != null) return 'llm';
  if (hasChildren) return 'chain';
  return 'unknown';
}

/** Above this span count the graph renders an honest "too large" state (mirrors VIRTUALIZE_THRESHOLD). */
export const GRAPH_NODE_CAP = 200;

/** Layout spacing (px) — deterministic order/depth grid; the SVG viewport scales to fit. */
const NODE_X_GAP = 168;
const NODE_Y_GAP = 96;

export interface GraphNode {
  spanId: string;
  name: string;
  kind: SpanKind;
  depth: number; // distance from root
  order: number; // index within its depth band
  x: number;
  y: number;
  error: boolean;
  selected: boolean;
  onPath: boolean;
}
export interface GraphEdge {
  from: string;
  to: string;
  onPath: boolean;
}
export interface TraceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  truncated: boolean;
  count: number;
}

/**
 * Build the deterministic layered graph. Edges come from **parent/call order** (`parentSpanId`), NOT
 * the nested `children[]`, so the negative cases are real + testable:
 * - a self-loop (`parentSpanId === spanId`) or a cycle is broken by a visited set (each span placed once);
 * - a span whose `parentSpanId` is absent from the trace is **attached under the root**, never dropped.
 * `onPath` = the root→selected ancestor chain (D4); with no selection, root→deepest-leaf (first-child tie).
 * Over `cap` spans → `{ truncated: true, nodes: [], edges: [] }` (D3).
 */
export function buildTraceGraph(root: TraceSpanNode, selectedId?: string, cap = GRAPH_NODE_CAP): TraceGraph {
  // Dedup by spanId (a malformed tree may repeat a span in `children[]`) so a node/edge/React-key is
  // emitted at most once (F3); the first occurrence wins.
  const seenIds = new Set<string>();
  const all = flattenAll(root).filter((s) => (seenIds.has(s.spanId) ? false : (seenIds.add(s.spanId), true)));
  const count = all.length;
  if (count > cap) {
    return { nodes: [], edges: [], width: 0, height: 0, truncated: true, count };
  }
  const byId = new Map(all.map((s) => [s.spanId, s]));

  // Effective parent: a valid, non-self, present parent — else the root (missing-parent attaches to root).
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  for (const s of all) {
    if (s.spanId === root.spanId) continue;
    const p = s.parentSpanId;
    const eff = p != null && p !== s.spanId && byId.has(p) ? p : root.spanId;
    parentOf.set(s.spanId, eff);
    (childrenOf.get(eff) ?? childrenOf.set(eff, []).get(eff)!).push(s.spanId);
  }

  // BFS from root → depth + order, with a visited guard (cycle-safe; each span placed once).
  const depthOf = new Map<string, number>();
  const orderOf = new Map<string, number>();
  const perDepth = new Map<number, number>();
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: root.spanId, depth: 0 }];
  visited.add(root.spanId);
  let maxDepth = 0;
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const order = perDepth.get(depth) ?? 0;
    perDepth.set(depth, order + 1);
    depthOf.set(id, depth);
    orderOf.set(id, order);
    maxDepth = Math.max(maxDepth, depth);
    for (const child of childrenOf.get(id) ?? []) {
      if (visited.has(child)) continue; // cycle / re-entry guard
      visited.add(child);
      queue.push({ id: child, depth: depth + 1 });
    }
  }

  // Re-attach any node the BFS never reached (part of a cycle that excludes the root — its effective
  // parent points inside the cycle, so root's BFS can't descend to it) under the root at depth 1 (F1):
  // an honest degraded view — shown + connected to root, never piled at the origin.
  for (const s of all) {
    if (depthOf.has(s.spanId)) continue;
    const order = perDepth.get(1) ?? 0;
    perDepth.set(1, order + 1);
    depthOf.set(s.spanId, 1);
    orderOf.set(s.spanId, order);
    parentOf.set(s.spanId, root.spanId);
    maxDepth = Math.max(maxDepth, 1);
  }

  // The execution path: root→selected ancestor chain, else root→deepest-leaf.
  const pathIds = computePath(root.spanId, selectedId, parentOf, depthOf, byId);
  const pathSet = new Set(pathIds);

  const nodes: GraphNode[] = all.map((s) => {
    const depth = depthOf.get(s.spanId) ?? 0;
    const order = orderOf.get(s.spanId) ?? 0;
    return {
      spanId: s.spanId,
      name: s.name,
      kind: deriveSpanKind(s),
      depth,
      order,
      x: order * NODE_X_GAP,
      y: depth * NODE_Y_GAP,
      error: isErrorStatus(s.statusCode),
      selected: selectedId != null && s.spanId === selectedId,
      onPath: pathSet.has(s.spanId),
    };
  });
  const edges: GraphEdge[] = all
    .filter((s) => s.spanId !== root.spanId)
    .map((s) => {
      const from = parentOf.get(s.spanId) ?? root.spanId;
      return { from, to: s.spanId, onPath: pathSet.has(from) && pathSet.has(s.spanId) };
    });

  const width = Math.max(1, ...Array.from(perDepth.values())) * NODE_X_GAP;
  const height = (maxDepth + 1) * NODE_Y_GAP;
  return { nodes, edges, width, height, truncated: false, count };
}

/** The ancestor chain root→selected (D4); with no selection, root→deepest-leaf (first-child tie-break). */
function computePath(
  rootId: string,
  selectedId: string | undefined,
  parentOf: Map<string, string>,
  depthOf: Map<string, number>,
  byId: Map<string, TraceSpanNode>,
): string[] {
  let target = selectedId != null && byId.has(selectedId) ? selectedId : undefined;
  if (target === undefined) {
    // deepest node; ties broken by the smaller order already imposed by BFS insertion (deterministic)
    let deepest = rootId;
    let best = -1;
    for (const [id, d] of depthOf) {
      if (d > best) {
        best = d;
        deepest = id;
      }
    }
    target = deepest;
  }
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = target;
  while (cur != null && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    if (cur === rootId) break;
    cur = parentOf.get(cur);
  }
  return chain;
}

/** Kind → display label + a colorblind-conscious token color (dark-surface tuned). */
export const KIND_LABEL: Record<SpanKind, string> = {
  llm: 'LLM',
  tool: 'Tool',
  retriever: 'Retriever',
  embedding: 'Embedding',
  chain: 'Chain',
  unknown: 'Span',
};
export const KIND_COLOR: Record<SpanKind, string> = {
  llm: '#6366f1',
  tool: '#f59e0b',
  retriever: '#06b6d4',
  embedding: '#a855f7',
  chain: '#22c55e',
  unknown: '#94a3b8',
};
