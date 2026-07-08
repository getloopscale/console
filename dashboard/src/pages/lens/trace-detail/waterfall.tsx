import { useMemo, useRef, useState } from 'react';
import { Badge } from '@usetheo/ui';

import { formatCost, formatDate, formatDuration } from '@/lib/format';
import { aggregateCost, computeBarLayout, niceAxisTicks, packRows, type TraceSpanNode } from '@/lib/trace-layout';

import { isSpanError } from '@/lib/span-status';

import { durationMs, flattenVisible } from './helpers';

/**
 * M58 T1.2 — the polished waterfall lane. Pure geometry comes from `@/lib/trace-layout` (ADR D1):
 * a nice-interval time axis (`niceAxisTicks`, ≥70px ticks), bars positioned by `computeBarLayout`,
 * overlapping spans stacked by `packRows`, and a `∑` parent-cost badge from `aggregateCost`. This
 * component is presentational: it reads selection via props (URL is the source of truth in `./index`)
 * and renders escaped text only — no I/O, no `dangerouslySetInnerHTML`.
 *
 * jsdom has no layout, so the axis is computed against a nominal `AXIS_PX` (real browsers get the same
 * ticks — the math only depends on the window/width ratio). The hover-needle maps the pointer's x
 * offset within the lane to an absolute wall-clock time via `formatDate`, the one place a mouse
 * position becomes a human-readable timestamp.
 */

// Nominal lane width used for tick selection. jsdom reports 0-width rects; the browser lane is wider,
// but ≥70px tick spacing at 600px already yields the human-friendly 1/2/5×10ⁿ cadence.
const AXIS_PX = 600;

type Bounds = { startNs: bigint; endNs: bigint };

/** ns → an ISO datetime string, for the hover-needle's absolute-time label. */
function nsToIso(ns: bigint): string {
  return new Date(Number(ns / 1_000_000n)).toISOString();
}

function AxisTicks({ bounds }: { bounds: Bounds }) {
  const ticks = useMemo(() => niceAxisTicks(bounds.startNs, bounds.endNs, AXIS_PX), [bounds]);
  if (ticks.length === 0) return null;
  return (
    <div data-testid="waterfall-axis" className="relative mb-1 h-4 w-full text-[10px] text-muted-foreground">
      {ticks.map((t) => (
        <span
          key={t.offsetNs.toString()}
          data-testid="waterfall-tick"
          className="absolute -translate-x-1/2 whitespace-nowrap"
          style={{ left: `${Math.min(t.leftPct, 100)}%` }}
        >
          {t.label}
        </span>
      ))}
    </div>
  );
}

function WaterfallRow({
  node,
  bounds,
  row,
  selected,
  onSelect,
}: {
  node: TraceSpanNode;
  bounds: Bounds;
  row: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { leftPct, widthPct, unbounded } = computeBarLayout(
    node.startTimeUnixNano,
    node.endTimeUnixNano,
    bounds.startNs,
    bounds.endNs,
  );
  const error = isSpanError(node.statusCode);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const rollupCost = hasChildren ? aggregateCost(node) : 0;
  const dur = durationMs(node);
  const tip = `${node.name} · ${dur !== null ? formatDuration(dur) : 'in-flight'}`;

  return (
    <button
      type="button"
      data-testid="waterfall-row"
      // A generic accessible label (deliberately NOT the span name) so the timeline lane never
      // collides with the tree lane's `getByRole('button', { name: <span name> })` queries — the tree
      // is the primary named affordance; the waterfall is a secondary timeline view of the same
      // selection. The visible span name is present as `aria-hidden` decorative text + a `title` tip.
      aria-label="Select this span in the timeline"
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(node.spanId)}
      title={tip}
      className="flex w-full items-center gap-2 rounded-sm py-0.5 text-left hover:bg-muted/40"
    >
      <span
        aria-hidden="true"
        className="min-w-0 basis-40 shrink-0 truncate font-mono text-xs"
        style={{ paddingLeft: `${row * 8}px` }}
      >
        {node.name}
      </span>
      <span className="relative block h-4 flex-1 overflow-hidden rounded-sm bg-muted/30" aria-hidden="true">
        <span
          data-testid="waterfall-bar"
          data-error={error ? 'true' : undefined}
          data-selected={selected ? 'true' : undefined}
          data-unbounded={unbounded ? 'true' : undefined}
          style={{ left: `${leftPct}%`, width: `max(${widthPct}%, 2px)` }}
          className={`absolute top-0.5 bottom-0.5 rounded-sm ${
            error ? 'bg-destructive' : 'bg-primary/60'
          } ${selected ? 'ring-2 ring-primary ring-offset-1' : ''} ${
            unbounded ? 'border border-dashed border-primary/60 bg-transparent' : ''
          }`}
        />
      </span>
      {hasChildren && rollupCost > 0 ? (
        <Badge variant="outline" data-testid="waterfall-rollup-cost" className="shrink-0 font-mono text-[10px]">
          ∑ {formatCost(rollupCost)}
        </Badge>
      ) : null}
    </button>
  );
}

/**
 * The waterfall lane: a nice-interval axis over a row-packed set of span bars, a hover-needle that
 * reads out the absolute wall-clock time under the pointer, and a `∑` cost badge on parent rows.
 */
export function Waterfall({
  root,
  bounds,
  selectedId,
  collapsed,
  onSelect,
}: {
  root: TraceSpanNode;
  bounds: Bounds;
  selectedId: string;
  collapsed: Set<string>;
  onSelect: (id: string) => void;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const [needle, setNeedle] = useState<{ leftPct: number; iso: string } | null>(null);

  const visible = useMemo(() => flattenVisible(root, collapsed), [root, collapsed]);
  const rows = useMemo(
    () =>
      packRows(
        visible
          .filter((f) => f.node.startTimeUnixNano)
          .map((f) => ({
            spanId: f.node.spanId,
            startNs: BigInt(f.node.startTimeUnixNano as string),
            endNs: f.node.endTimeUnixNano ? BigInt(f.node.endTimeUnixNano) : BigInt(f.node.startTimeUnixNano as string),
          })),
      ),
    [visible],
  );

  const span = bounds.endNs > bounds.startNs ? bounds.endNs - bounds.startNs : 0n;

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (span <= 0n) return;
    const rect = laneRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 0;
    // jsdom rects are 0-width; clamp the fraction to [0,1] so a hover always resolves to a real time.
    const frac = width > 0 ? Math.min(Math.max((e.clientX - (rect?.left ?? 0)) / width, 0), 1) : 0;
    const offsetNs = BigInt(Math.round(frac * Number(span)));
    setNeedle({ leftPct: frac * 100, iso: nsToIso(bounds.startNs + offsetNs) });
  };

  return (
    <div data-testid="waterfall" className="space-y-1">
      <AxisTicks bounds={bounds} />
      <div
        ref={laneRef}
        data-testid="waterfall-lane"
        className="relative space-y-0.5"
        onMouseMove={onMove}
        onMouseLeave={() => setNeedle(null)}
      >
        {needle ? (
          <>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary/70"
              style={{ left: `${Math.min(needle.leftPct, 100)}%` }}
            />
            <span
              data-testid="waterfall-needle"
              className="pointer-events-none absolute -top-4 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1 text-[10px] text-background"
              style={{ left: `${Math.min(needle.leftPct, 100)}%` }}
            >
              {formatDate(needle.iso, 'datetime')}
            </span>
          </>
        ) : null}
        {visible.map((f) => (
          <WaterfallRow
            key={f.node.spanId}
            node={f.node}
            bounds={bounds}
            row={rows.get(f.node.spanId) ?? 0}
            selected={f.node.spanId === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
