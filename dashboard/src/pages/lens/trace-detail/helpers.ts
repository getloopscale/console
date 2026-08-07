/**
 * Pure, total layout/parse helpers for the trace-detail view (M58 D1 extraction).
 *
 * These moved out of `src/pages/lens/trace-detail.tsx` (now a re-export shim) so the view module
 * dir stays under the 500-LoC budget (docs/adr/0002-orcamento-de-loc-por-arquivo.md) and the
 * math stays unit-testable in isolation. Every function
 * here is pure and total — it never throws and never does I/O. The public helper surface
 * (`TraceSpanNode`, `durationMs`, `prettyValue`, `asChat`, `computeTraceBounds`, `computeBarLayout`,
 * `flattenVisible`) e re-exportada pelo shim `../trace-detail.tsx`. NOTA: `playground.tsx`,
 * `compare.tsx` passou a importar DESTE modulo diretamente (B-001) — era o
 * import via shim que fechava os ciclos da familia lens.
 *
 * M58 T1.1 — `TraceSpanNode`, `computeTraceBounds`, and `computeBarLayout` now live in the pure
 * leaf module `@/pages/lens/trace-layout` (with the new axis / row-pack / ∑-cost math). They are re-exported
 * here so every existing importer keeps resolving; this file keeps the parse/flatten helpers.
 */

export {
  computeBarLayout,
  type TraceSpanNode,
} from '@/pages/lens/components/trace-layout';
import type { TraceSpanNode } from '@/pages/lens/components/trace-layout';

/** One OpenAI-shaped tool call attached to an assistant message. */
export interface ToolCall {
  id: string;
  function?: { name?: string; arguments?: string };
}

export interface ChatMessage {
  role: string;
  content: unknown;
  // M58 P3.2 — OpenAI tool-call passthrough. An assistant message may carry `tool_calls`; the matching
  // `tool` result message carries `tool_call_id`. Optional/additive so the existing `{role,content}`
  // detection and every existing `asChat` test stay green (a chat message need not have either).
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface FlatNode {
  node: TraceSpanNode;
  depth: number;
}

/** Span duration in ms; null when unavailable or clock-skewed (end < start). */
export function durationMs(n: Pick<TraceSpanNode, 'startTimeUnixNano' | 'endTimeUnixNano'>): number | null {
  if (!n.startTimeUnixNano || !n.endTimeUnixNano) return null;
  try {
    const ms = (BigInt(n.endTimeUnixNano) - BigInt(n.startTimeUnixNano)) / 1_000_000n;
    return ms < 0n ? null : Number(ms);
  } catch {
    return null;
  }
}

/** Pretty-print a stringified value as JSON when parseable, else leave it raw. Always plain text. */
export function prettyValue(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

/** Parse a value as a chat-message array (`[{role, content}, …]`) or null when it is not one. */
export function asChat(value: string): ChatMessage[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((m) => m !== null && typeof m === 'object' && 'role' in m && 'content' in m)
    ) {
      return parsed as ChatMessage[];
    }
  } catch {
    /* not JSON → not chat */
  }
  return null;
}

/** Depth-first flatten of ALL spans (ignores collapse) — used to resolve the selected span by id. */
export function flattenAll(root: TraceSpanNode): TraceSpanNode[] {
  const out: TraceSpanNode[] = [root];
  for (const c of root.children ?? []) out.push(...flattenAll(c));
  return out;
}

/** Depth-first flatten of VISIBLE spans (a node in `collapsed` contributes no descendants). */
export function flattenVisible(root: TraceSpanNode, collapsed: Set<string>): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (n: TraceSpanNode, depth: number) => {
    out.push({ node: n, depth });
    if (!collapsed.has(n.spanId)) for (const c of n.children ?? []) walk(c, depth + 1);
  };
  walk(root, 0);
  return out;
}
