import type { TraceSpanNode } from '@/lib/lens/trace-layout';
import { flattenAll } from '../trace-detail/helpers';

/**
 * M132 — the pure boundary mapper for the Session Conversation replay. Given the session's traces
 * (ordering metadata) + their fetched full-I/O trees, produce ordered turns — one Human input + one
 * AI output per trace — WITHOUT assuming which span carries the I/O (producer-agnostic: a Claude Code
 * root span has no I/O, its `claude_code.tool` child does; a demo root carries it). Pure + total: a
 * missing/empty tree yields an absent-I/O turn, never a throw. Tested in isolation like `to-session-item`.
 */

/** The session-trace ordering metadata (from the session's trace-list read). */
export interface SessionTraceRef {
  traceId: string;
  startTimeUnixNano?: string;
  name?: string;
}

export interface ConversationTurn {
  traceId: string;
  /** 1-based turn number (conversation order). */
  index: number;
  name?: string;
  /** the representative user input (earliest span with non-empty inputValue); absent → undefined. */
  input?: string;
  /** the representative assistant output (latest span with non-empty outputValue); absent → undefined. */
  output?: string;
  /** true when the trace tree failed to load (null) — distinct from a loaded-but-empty trace. */
  loadFailed?: boolean;
}

/** Numeric-safe ascending compare of unix-nano strings (longer digit-string = larger; then lexical). */
function cmpNano(a?: string, b?: string): number {
  const as = a ?? '0';
  const bs = b ?? '0';
  if (as.length !== bs.length) return as.length - bs.length;
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function nonEmpty(s: string | undefined): s is string {
  return s != null && s.trim() !== '';
}

/** Representative I/O of a trace tree: earliest non-empty input, latest non-empty output (any span). */
function representativeIO(root: TraceSpanNode): { input?: string; output?: string } {
  const spans = flattenAll(root);
  const inputs = spans.filter((s) => nonEmpty(s.inputValue)).sort((a, b) => cmpNano(a.startTimeUnixNano, b.startTimeUnixNano));
  const outputs = spans.filter((s) => nonEmpty(s.outputValue)).sort((a, b) => cmpNano(a.startTimeUnixNano, b.startTimeUnixNano));
  const out: { input?: string; output?: string } = {};
  if (inputs[0]?.inputValue != null) out.input = inputs[0].inputValue;
  const lastOut = outputs[outputs.length - 1]?.outputValue;
  if (lastOut != null) out.output = lastOut;
  return out;
}

/**
 * Sort session-trace refs into conversation order (by span start asc). MUST be applied BEFORE capping
 * the per-trace fetch fan-out — the session read endpoint returns newest-first (traces.tsx defensive
 * sort), so capping the raw order would keep the LATEST turns and drop the true start of the
 * conversation. Sort → then slice keeps the EARLIEST N turns in order.
 */
export function sortSessionTracesByStart(traces: SessionTraceRef[]): SessionTraceRef[] {
  return [...traces].sort((a, b) => cmpNano(a.startTimeUnixNano, b.startTimeUnixNano));
}

/**
 * Build the ordered conversation turns. `treeByTraceId` maps each trace to its fetched full-I/O tree,
 * or `null` when that trace's tree fetch failed (→ the turn is flagged `loadFailed`).
 */
export function toConversationTurns(
  traces: SessionTraceRef[],
  treeByTraceId: Map<string, TraceSpanNode | null>,
): ConversationTurn[] {
  const ordered = [...traces].sort((a, b) => cmpNano(a.startTimeUnixNano, b.startTimeUnixNano));
  return ordered.map((t, i) => {
    const turn: ConversationTurn = { traceId: t.traceId, index: i + 1 };
    if (t.name != null) turn.name = t.name;
    if (!treeByTraceId.has(t.traceId)) return turn; // not fetched yet (pending) → bare turn
    const tree = treeByTraceId.get(t.traceId) ?? null;
    if (tree === null) {
      turn.loadFailed = true; // fetch resolved to null (error) — distinct from empty
      return turn;
    }
    const io = representativeIO(tree);
    if (io.input != null) turn.input = io.input;
    if (io.output != null) turn.output = io.output;
    return turn;
  });
}
