/**
 * Pure compare/diff core for the trace-run compare view (theo-lens M54). No I/O, no React —
 * deterministic + unit-tested. Three pieces:
 *  - `numericDelta`  — honest delta math (Langfuse `calculateNumericDiff` idiom: absolute + direction
 *                      + percent, `null` on equal or a missing side — never a fabricated `+0`).
 *  - `alignSpanTrees`— match spans across two trees by name + kind + sibling-ordinal path; unmatched
 *                      spans become "only-in-a"/"only-in-b" rows (D1 — no peer precedent; the honesty
 *                      keystone). Suppresses deltas across non-corresponding spans.
 *  - `traceMetrics`  — per-trace roll-up (duration from root, tokens/cost from the M5 cost summary,
 *                      error from any error span) for the delta table.
 */
import { durationMs, type TraceSpanNode } from './trace-detail';
import { isSpanError } from '../../lib/span-status';

/** Per-trace cost summary DTO — theo-lens `GET /v1/traces/:id/cost` (M5). */
export interface TraceCostSummary {
  traceId: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface Delta {
  /** Magnitude of the change (always ≥ 0). */
  absolute: number;
  /** '+' when current > baseline (worse for a lower-is-better metric), '−' when current < baseline. */
  direction: '+' | '−';
  /** Percent change vs baseline; `null` when baseline is 0 (undefined percentage). */
  percent: number | null;
}

/**
 * Honest numeric delta. Returns `null` when the values are equal (no badge — no visual noise) or when
 * either side is missing (never fabricate a delta across an absent value). Copies the Langfuse
 * `calculateNumericDiff` shape (`.claude/knowledge-base/references/langfuse/web/src/features/datasets/lib/calculateBaselineDiff.ts`).
 */
export function numericDelta(
  current: number | undefined,
  baseline: number | undefined,
): Delta | null {
  if (current === undefined || baseline === undefined) return null;
  const diff = current - baseline;
  if (diff === 0) return null;
  const absolute = Math.abs(diff);
  const direction: '+' | '−' = diff > 0 ? '+' : '−';
  const percent = baseline === 0 ? null : (absolute / Math.abs(baseline)) * 100;
  return { absolute, direction, percent };
}

export type AlignStatus = 'matched' | 'only-in-a' | 'only-in-b';

export interface AlignRow {
  /** name\0kind\0ordinal — stable within a level, disambiguates repeated same-name siblings. */
  key: string;
  /** Nesting depth (root = 0). */
  depth: number;
  status: AlignStatus;
  a?: TraceSpanNode;
  b?: TraceSpanNode;
}

export interface AlignResult {
  /** True iff every row matched — i.e. the two structures are identical. When false, the UI marks
   *  the compare "structurally different" and shows the unmatched spans as "only in A/B". */
  comparable: boolean;
  rows: AlignRow[];
}

/** Per-node key among its siblings: name + kind + ordinal (count of preceding same-name+kind sibs). */
function childKeys(nodes: TraceSpanNode[]): string[] {
  const seen = new Map<string, number>();
  return nodes.map((n) => {
    const base = `${n.name}\0${n.kind ?? ''}`;
    const ordinal = seen.get(base) ?? 0;
    seen.set(base, ordinal + 1);
    return `${base}\0${ordinal}`;
  });
}

/** Emit `node` and its whole subtree as `status` rows (used for an entire unmatched branch). */
function emitBranch(node: TraceSpanNode, key: string, depth: number, status: AlignStatus, out: AlignRow[]): void {
  out.push(status === 'only-in-b' ? { key, depth, status, b: node } : { key, depth, status, a: node });
  const kids = node.children ?? [];
  const keys = childKeys(kids);
  kids.forEach((child, i) => emitBranch(child, keys[i], depth + 1, status, out));
}

/** Align a matched pair's children level, recursing into matched pairs; emit only-in rows in order. */
function alignLevel(aKids: TraceSpanNode[], bKids: TraceSpanNode[], depth: number, out: AlignRow[]): void {
  const aKeys = childKeys(aKids);
  const bKeys = childKeys(bKids);
  const bByKey = new Map<string, { node: TraceSpanNode; used: boolean }>();
  bKeys.forEach((k, i) => bByKey.set(k, { node: bKids[i], used: false }));

  aKids.forEach((aNode, i) => {
    const k = aKeys[i];
    const match = bByKey.get(k);
    if (match) {
      match.used = true;
      out.push({ key: k, depth, status: 'matched', a: aNode, b: match.node });
      alignLevel(aNode.children ?? [], match.node.children ?? [], depth + 1, out);
    } else {
      emitBranch(aNode, k, depth, 'only-in-a', out);
    }
  });
  // B children with no A counterpart, in original order.
  bKids.forEach((bNode, i) => {
    const k = bKeys[i];
    const entry = bByKey.get(k);
    if (entry && !entry.used) emitBranch(bNode, k, depth, 'only-in-b', out);
  });
}

/**
 * Align two span trees. The roots are aligned as a top-level pair: if their name+kind match they are a
 * matched root and their children are aligned recursively; if they differ, each root subtree is emitted
 * as only-in (fully "structurally different"). Match key is name + kind + sibling-ordinal path (D1).
 */
export function alignSpanTrees(a: TraceSpanNode, b: TraceSpanNode): AlignResult {
  const rows: AlignRow[] = [];
  const [ka] = childKeys([a]);
  const [kb] = childKeys([b]);
  if (ka === kb) {
    rows.push({ key: ka, depth: 0, status: 'matched', a, b });
    alignLevel(a.children ?? [], b.children ?? [], 1, rows);
  } else {
    emitBranch(a, ka, 0, 'only-in-a', rows);
    emitBranch(b, kb, 0, 'only-in-b', rows);
  }
  const comparable = rows.every((r) => r.status === 'matched');
  return { comparable, rows };
}

export interface TraceMetrics {
  /** Root span wall-clock in ms (null when the root has no bounded end). */
  durationMs: number | null;
  /** Total tokens — the cost summary's `totalTokens` when present, else summed over the tree. */
  tokens: number;
  /** Cost in USD from the M5 summary; `null` when the cost fetch degraded (never fabricated). */
  costUsd: number | null;
  /** True when any span reports an error status (shared `isSpanError` predicate — issue #176). */
  hasError: boolean;
}

/**
 * True when a span's statusCode signals an error — the shared canonical predicate.
 * Re-exported under the historical name so compare.tsx keeps its import; the honest
 * implementation lives in `lib/span-status` (issue #176 — was `sc !== '0'`, which
 * flagged OK spans as errors).
 */
export const isErrorStatus = isSpanError;

/** A single span's own token count (input + output) — for the per-span tokens delta. */
export function spanTokens(node: TraceSpanNode): number {
  return (node.inputTokens ?? 0) + (node.outputTokens ?? 0);
}

function sumTreeTokens(node: TraceSpanNode): number {
  let total = (node.inputTokens ?? 0) + (node.outputTokens ?? 0);
  for (const c of node.children ?? []) total += sumTreeTokens(c);
  return total;
}

function anyError(node: TraceSpanNode): boolean {
  if (isErrorStatus(node.statusCode)) return true;
  return (node.children ?? []).some(anyError);
}

/** Per-trace metric roll-up used by the delta table. */
export function traceMetrics(root: TraceSpanNode, cost: TraceCostSummary | undefined): TraceMetrics {
  const tokens = cost?.totalTokens ?? sumTreeTokens(root);
  return {
    durationMs: durationMs(root),
    tokens,
    costUsd: cost?.costUsd ?? null,
    hasError: anyError(root),
  };
}
