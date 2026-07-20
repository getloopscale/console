/**
 * Pure, total waterfall-layout math for the trace-detail view (M58 T1.1 extraction).
 *
 * This module owns the geometry the waterfall renders: the trace time envelope (`computeTraceBounds`),
 * a single span's bar position (`computeBarLayout`), a human-friendly time axis (`niceAxisTicks`),
 * overlapping-span row packing (`packRows`), and `∑`-cost aggregation over a subtree (`aggregateCost`
 * / `spanCostUsd`). Every function is pure and total — it NEVER throws and NEVER does I/O. Extracting
 * it out of the 680-LoC React view (ADR D1) is what makes the skew / missing-timestamp / overlap /
 * degenerate-bounds negative cases (rules/testing.md §4.1) provable without rendering.
 *
 * `TraceSpanNode` + `computeTraceBounds` + `computeBarLayout` moved here from `../pages/lens/
 * trace-detail/helpers.ts`, which now re-exports them so `trace-detail.test.tsx`, the D1 shim,
 * `compare.tsx`, `compare-core.ts`, and `playground.tsx` keep resolving with zero churn.
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
  // M58 T1.1 — an optional per-span USD cost. The trace-level summary (`TraceCostSummary`, M5) is the
  // authoritative roll-up; when the engine promotes a per-span cost it arrives here (additive, like
  // `inputTokens?`/`ttftMs?`). `aggregateCost` falls back to a cost attribute otherwise (see
  // `spanCostUsd`) so the `∑` badge is honest whether cost lands on the field or an attribute.
  costUsd?: number;
  attributes?: Record<string, unknown>;
  events?: Array<{ name: string; timeUnixNano?: string; attributes?: Record<string, unknown> }>;
  // M78 — machine evaluations for this span (from the ingest-populated `span_evaluations`, carried on
  // the trace-detail read). Distinct from human tags/notes; absent when the span was never evaluated.
  evaluations?: Array<{ name: string; score?: number; label?: string; explanation?: string }>;
  children?: TraceSpanNode[];
}

/** Depth-first flatten of ALL spans — the honest envelope input for bounds/cost aggregation. */
function flattenAll(root: TraceSpanNode): TraceSpanNode[] {
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
 * Clock-skew (end < start) is treated like a missing end: zero-width + `unbounded`, never a throw.
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
  // A skewed end (before the start) cannot draw a bar — flag it unbounded, same as a missing end.
  const skewed = end !== null && end < start;
  const unbounded = end === null || skewed;
  const effEnd = end !== null && !skewed ? end : start;
  // percent with 2 decimals via integer bigint math: (delta * 10000 / span) / 100
  const pct = (delta: bigint) => (delta > 0n ? Number((delta * 10_000n) / span) / 100 : 0);
  const leftPct = Math.min(Math.max(pct(start - traceStartNs), 0), 100);
  const rawWidth = effEnd > start ? pct(effEnd - start) : 0;
  const widthPct = Math.min(Math.max(rawWidth, 0), 100 - leftPct);
  return { leftPct, widthPct, unbounded };
}

/** One tick on the waterfall time axis: its offset from the trace start, its label, its left %. */
export interface AxisTick {
  offsetNs: bigint;
  label: string;
  leftPct: number;
}

// The 1/2/5×10ⁿ "nice number" ladder (langfuse TimelineScale) — the mantissas we snap step size to.
const NICE_MANTISSAS = [1n, 2n, 5n];
const MIN_TICK_PX = 70; // ≥70px between ticks so labels never collide (blueprint §4).

/** Format a nanosecond offset as a compact ms / s / min label by magnitude. Pure, no locale. */
function labelForNs(offsetNs: bigint): string {
  const ns = Number(offsetNs);
  if (ns >= 60_000_000_000) {
    // ≥ 1 min
    const min = ns / 60_000_000_000;
    return `${trimZeros(min)}min`;
  }
  if (ns >= 1_000_000_000) {
    // ≥ 1 s
    return `${trimZeros(ns / 1_000_000_000)}s`;
  }
  // sub-second → milliseconds
  return `${trimZeros(ns / 1_000_000)}ms`;
}

/** Render a number with at most 2 decimals and no trailing zeros (`1.50 → "1.5"`, `2.0 → "2"`). */
function trimZeros(n: number): string {
  return parseFloat(n.toFixed(2)).toString();
}

/**
 * Human-friendly time axis: pick a step from the 1/2/5×10ⁿ ladder so that `pxWidth / tickCount ≥ 70`,
 * then emit ticks at 0, step, 2·step, … across the trace span. Labels are ms/s/min by magnitude.
 * Total: a degenerate span (end ≤ start) or non-positive width yields an empty axis, never a throw.
 */
export function niceAxisTicks(startNs: bigint, endNs: bigint, pxWidth: number): AxisTick[] {
  if (endNs <= startNs || !(pxWidth > 0)) return [];
  const spanNs = endNs - startNs;
  const maxTicks = Math.max(1, Math.floor(pxWidth / MIN_TICK_PX));
  // The smallest "nice" step whose tick count does not exceed maxTicks: step ≥ spanNs / maxTicks.
  const targetNs = Number(spanNs) / maxTicks;
  const step = niceStep(targetNs);
  if (step <= 0n) return [];

  const ticks: AxisTick[] = [];
  const spanNum = Number(spanNs);
  for (let offset = 0n; offset <= spanNs; offset += step) {
    const leftPct = (Number(offset) / spanNum) * 100;
    ticks.push({ offsetNs: offset, label: labelForNs(offset), leftPct });
  }
  return ticks;
}

/** The smallest 1/2/5×10ⁿ step ≥ `targetNs`. Pure integer ladder walk (no Math.log rounding traps). */
function niceStep(targetNs: number): bigint {
  if (!(targetNs > 0)) return 0n;
  let pow = 1n; // 10ⁿ, starting at 1 ns
  // Cap the walk well beyond any realistic trace (10²⁴ ns ≈ 31.7 billion years) so it always halts.
  for (let guard = 0; guard < 32; guard++) {
    for (const m of NICE_MANTISSAS) {
      const candidate = m * pow;
      if (Number(candidate) >= targetNs) return candidate;
    }
    pow *= 10n;
  }
  return pow; // unreachable in practice; a total fallback rather than a throw
}

/**
 * Greedy single-pass row packing for overlapping spans (laminar's "gravity"). Sort by start, then
 * assign each span the lowest row whose last-placed span ended at/before this span's start; overlapping
 * spans therefore land on separate rows. Returns `Map<spanId, rowIndex>`. Total: `[]` → empty map.
 */
export function packRows(spans: { spanId: string; startNs: bigint; endNs: bigint }[]): Map<string, number> {
  const rows = new Map<string, number>();
  const rowEnds: bigint[] = []; // rowEnds[r] = the end time of the last span placed on row r
  const ordered = [...spans].sort((a, b) => (a.startNs < b.startNs ? -1 : a.startNs > b.startNs ? 1 : 0));
  for (const s of ordered) {
    // A skewed span (end < start) occupies a point at its start so it never "covers" a later row.
    const end = s.endNs >= s.startNs ? s.endNs : s.startNs;
    let placed = -1;
    for (let r = 0; r < rowEnds.length; r++) {
      if (rowEnds[r] <= s.startNs) {
        placed = r;
        break;
      }
    }
    if (placed === -1) {
      placed = rowEnds.length;
      rowEnds.push(end);
    } else {
      rowEnds[placed] = end;
    }
    rows.set(s.spanId, placed);
  }
  return rows;
}

// Attribute keys (checked in order) a per-span cost may arrive under when it is not a promoted field.
const COST_ATTRIBUTE_KEYS = ['gen_ai.usage.cost', 'gen_ai.usage.cost_usd', 'cost_usd', 'cost'];

/**
 * A single span's own USD cost. Prefers the promoted `costUsd` field; else the first parseable cost
 * attribute (`gen_ai.usage.cost` …). Total: a missing or non-numeric cost yields 0, never NaN — so a
 * `∑` badge is honest rather than showing "$NaN". Negative costs are floored to 0 (a cost is ≥ 0).
 */
export function spanCostUsd(node: TraceSpanNode): number {
  if (typeof node.costUsd === 'number' && Number.isFinite(node.costUsd)) {
    return node.costUsd > 0 ? node.costUsd : 0;
  }
  const attrs = node.attributes ?? {};
  for (const key of COST_ATTRIBUTE_KEYS) {
    if (!(key in attrs)) continue;
    const raw = attrs[key];
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (Number.isFinite(n)) return n > 0 ? n : 0;
  }
  return 0;
}

/**
 * A single span's OWN cost for per-span DISPLAY: `undefined` when the span has no individually-computed
 * cost (absent / non-numeric / ≤ 0), else the positive value. Mirror of `@usetheo/ui`'s `spanOwnCostUsd`
 * (M52 / theo-lens#71 Finding 3). Distinct from `spanCostUsd` (which collapses to 0 for honest `∑`
 * badges): a per-span cost "exists or doesn't", so the absent case renders `—` (em-dash) instead of a
 * fabricated `$0.0000`. Cost is a trace-level aggregate — most spans have no cost of their own.
 */
export function spanOwnCostUsd(node: TraceSpanNode): number | undefined {
  if (typeof node.costUsd === 'number' && Number.isFinite(node.costUsd)) {
    return node.costUsd > 0 ? node.costUsd : undefined;
  }
  const attrs = node.attributes ?? {};
  for (const key of COST_ATTRIBUTE_KEYS) {
    if (!(key in attrs)) continue;
    const raw = attrs[key];
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (Number.isFinite(n)) return n > 0 ? n : undefined;
  }
  return undefined;
}

/** Sum a node's own cost + all descendants' cost (`∑`). Total: missing cost counts as 0, never NaN. */
export function aggregateCost(node: TraceSpanNode): number {
  let total = spanCostUsd(node);
  for (const c of node.children ?? []) total += aggregateCost(c);
  return total;
}

// ---- M58 T4.1 — reader-mode Transcript row model ----

/** Per-row micro-stats surfaced by the Transcript feed. Missing inputs collapse to 0/null, never NaN. */
export interface TranscriptRowStats {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number | null;
}

/**
 * One row in the reader-mode Transcript feed. A `span` row renders a Card (role + preview + stats);
 * a `group-header` row is a collapsible header for a subagent subtree (its `groupId` == the subtree
 * root's `spanId`). Every row carries the `spanId` it belongs to so the view can sync URL selection.
 */
export interface TranscriptRow {
  kind: 'span' | 'group-header';
  spanId: string;
  role?: string;
  preview?: string;
  stats?: TranscriptRowStats;
  groupId?: string;
}

// A span whose output preview is longer than this is sliced (the full body lives in the detail pane).
const TRANSCRIPT_PREVIEW_CHARS = 140;
// Subagent-grouping rule (M58 T4.1): the fixtures carry OTel numeric `kind` values (1/2/…), not agent
// semantics, so there is NO reliable agent-kind signal in the data. The simplest defensible rule
// (documented per the plan) is: a node that fans out into ≥2 children is treated as a subagent subtree
// and gets a collapsible `group-header` row before its children. A single-child chain is a plain span.
const SUBAGENT_MIN_CHILDREN = 2;

/** Role label for a Transcript row: prefer the span `kind`, else the span `name`. Total, never empty-crash. */
function transcriptRole(node: TraceSpanNode): string {
  return node.kind ?? node.name ?? 'span';
}

/** A short, single-line preview of a span's output (empty string when absent — never a crash). */
function transcriptPreview(node: TraceSpanNode): string {
  const raw = node.outputValue ?? '';
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine.length > TRANSCRIPT_PREVIEW_CHARS
    ? `${oneLine.slice(0, TRANSCRIPT_PREVIEW_CHARS)}…`
    : oneLine;
}

/**
 * Flatten a span tree into the ordered reader-mode Transcript feed (M58 T4.1, ADR D2). Pre-order walk
 * (root, then children depth-first) so `span`-row order matches `flattenVisible`. A subagent subtree
 * (a node with ≥ SUBAGENT_MIN_CHILDREN children — see the rule note above) emits a `group-header` row
 * BEFORE its child rows so the view can collapse the group. Pure + total: a single default span yields
 * exactly one `span` row; a missing `outputValue` yields an empty preview, never a throw.
 */
export function toTranscriptRows(root: TraceSpanNode): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const walk = (node: TraceSpanNode) => {
    const children = node.children ?? [];
    let dur: number | null = null;
    if (node.startTimeUnixNano && node.endTimeUnixNano) {
      try {
        const ms = (BigInt(node.endTimeUnixNano) - BigInt(node.startTimeUnixNano)) / 1_000_000n;
        dur = ms < 0n ? null : Number(ms);
      } catch {
        dur = null; // unparseable timestamps → no duration, never a throw
      }
    }
    rows.push({
      kind: 'span',
      spanId: node.spanId,
      role: transcriptRole(node),
      preview: transcriptPreview(node),
      stats: {
        inputTokens: node.inputTokens ?? 0,
        outputTokens: node.outputTokens ?? 0,
        costUsd: spanCostUsd(node),
        durationMs: dur,
      },
    });
    // A fan-out node is a subagent subtree — announce it with a collapsible header before its children.
    if (children.length >= SUBAGENT_MIN_CHILDREN) {
      rows.push({ kind: 'group-header', spanId: node.spanId, groupId: node.spanId });
    }
    for (const c of children) walk(c);
  };
  walk(root);
  return rows;
}
