/**
 * Pure, total layout/parse helpers for the trace-detail view (M58 D1 extraction).
 *
 * These moved out of `src/pages/lens/trace-detail.tsx` (now a re-export shim) so the view module
 * dir stays under the 500-LoC budget and the math stays unit-testable in isolation. Every function
 * here is pure and total — it never throws and never does I/O. The public helper surface
 * (`TraceSpanNode`, `durationMs`, `prettyValue`, `asChat`, `computeTraceBounds`, `computeBarLayout`,
 * `flattenVisible`, `VIRTUALIZE_THRESHOLD`) is re-exported from `./index` and from the shim, so the
 * existing imports in `trace-detail.test.tsx`, `compare.tsx`, `compare-core.ts`, and `playground.tsx`
 * keep resolving with zero churn.
 */

export interface TraceSpanNode {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  kind?: string;
  statusCode?: string;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  ttftMs?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  inputValue?: string;
  outputValue?: string;
  attributes?: Record<string, unknown>;
  events?: Array<{ name: string; timeUnixNano?: string; attributes?: Record<string, unknown> }>;
  children?: TraceSpanNode[];
}

export interface ChatMessage {
  role: string;
  content: unknown;
}

export interface FlatNode {
  node: TraceSpanNode;
  depth: number;
}

// Above this many visible rows, switch from the recursive render to the react-virtual flat-list.
// Our Claude Code agent traces are small (a handful of spans), so the common path stays recursive;
// virtualization engages only when it earns its complexity (blueprint D2; langfuse uses 350).
export const VIRTUALIZE_THRESHOLD = 200;

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

/**
 * Trace time bounds — min start / max end across ALL spans (in ns, BigInt-safe). The honest envelope
 * for the waterfall denominator (laminar's approach; not root-only, which lets a child overflow —
 * phoenix's weakness). Unparseable timestamps are skipped; a trace with no timestamps returns 0/0.
 */
export function computeTraceBounds(root: TraceSpanNode): { startNs: bigint; endNs: bigint } {
  let start: bigint | null = null;
  let end: bigint | null = null;
  for (const n of flattenAll(root)) {
    if (!n.startTimeUnixNano) continue;
    let s: bigint;
    try {
      s = BigInt(n.startTimeUnixNano);
    } catch {
      continue; // unparseable start → the span cannot be placed; skip it entirely
    }
    if (start === null || s < start) start = s;
    // A valid start always counts even when the end is missing/unparseable (fall back to the start).
    let e = s;
    if (n.endTimeUnixNano) {
      try {
        e = BigInt(n.endTimeUnixNano);
      } catch {
        e = s;
      }
    }
    if (end === null || e > end) end = e;
  }
  const s = start ?? 0n;
  return { startNs: s, endNs: end ?? s };
}

/**
 * Pure waterfall bar layout: map a span's [start, end] against the trace bounds → clamped
 * {leftPct, widthPct} in [0,100] with `leftPct + widthPct ≤ 100`. Converges the SOTA peers
 * (blueprint ADR D1): div-by-zero guard (opik), missing-end → zero-width `unbounded` (langfuse),
 * clamp [0,100] (opik). BigInt ns arithmetic (no float precision loss); percentages carry 2 decimals.
 */
export function computeBarLayout(
  spanStartNs: string | undefined,
  spanEndNs: string | undefined,
  traceStartNs: bigint,
  traceEndNs: bigint,
): { leftPct: number; widthPct: number; unbounded: boolean } {
  const span = traceEndNs > traceStartNs ? traceEndNs - traceStartNs : 1n; // div-by-zero guard
  if (!spanStartNs) return { leftPct: 0, widthPct: 0, unbounded: true };
  let start: bigint;
  let end: bigint | null;
  try {
    start = BigInt(spanStartNs);
    end = spanEndNs ? BigInt(spanEndNs) : null;
  } catch {
    return { leftPct: 0, widthPct: 0, unbounded: true };
  }
  const unbounded = end === null;
  const effEnd = end ?? start;
  // percent with 2 decimals via integer bigint math: (delta * 10000 / span) / 100
  const pct = (delta: bigint) => (delta > 0n ? Number((delta * 10_000n) / span) / 100 : 0);
  const leftPct = Math.min(Math.max(pct(start - traceStartNs), 0), 100);
  const rawWidth = effEnd > start ? pct(effEnd - start) : 0;
  const widthPct = Math.min(Math.max(rawWidth, 0), 100 - leftPct);
  return { leftPct, widthPct, unbounded };
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
