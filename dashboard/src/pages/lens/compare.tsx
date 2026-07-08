import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Card, EmptyState, PageShell, Skeleton } from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';
import { formatCost } from '@/lib/format';
import {
  computeBarLayout,
  computeTraceBounds,
  durationMs,
  flattenVisible,
  type TraceSpanNode,
} from './trace-detail';
import {
  alignSpanTrees,
  isErrorStatus,
  numericDelta,
  spanTokens,
  traceMetrics,
  type AlignRow,
  type Delta,
  type TraceCostSummary,
  type TraceMetrics,
} from './compare-core';

/**
 * M54 — /observability/compare?ids=A,B. Compare two traces side by side: per-lane timelines (reusing
 * the M50 waterfall helpers) + a metrics delta table (duration/cost/tokens/error, per-trace + per-span
 * where alignable). Deltas are honest: faster/slower + cheaper/costlier; when the two structures
 * diverge, unmatched spans are marked "only in A/B" and the delta is suppressed — never a fabricated
 * 1:1 diff (D1). The first id is the baseline. Both traces stay tenant-scoped (the BFF proxy resolves
 * the Principal; a foreign/missing trace is refused upstream → per-lane error).
 */

const EMPTY_COLLAPSED = new Set<string>();

interface LaneData {
  id: string;
  tree: TraceSpanNode | undefined;
  cost: TraceCostSummary | undefined;
  treeError: boolean;
  costError: boolean;
  pending: boolean;
  metrics: TraceMetrics | undefined;
}

function useLane(id: string | undefined): LaneData {
  const treeQ = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/traces', id, 'tree'] as const,
    queryFn: () => cloudFetch<TraceSpanNode>(`/v1/dashboard/lens/traces/${encodeURIComponent(id!)}`),
    enabled: !!id,
  });
  const costQ = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/traces', id, 'cost'] as const,
    queryFn: () => cloudFetch<TraceCostSummary>(`/v1/dashboard/lens/traces/${encodeURIComponent(id!)}/cost`),
    enabled: !!id,
  });
  const tree = treeQ.data ?? undefined;
  const cost = costQ.data ?? undefined;
  const metrics = tree ? traceMetrics(tree, cost) : undefined;
  return {
    id: id ?? '',
    tree,
    cost,
    treeError: treeQ.isError,
    costError: costQ.isError,
    pending: !!id && treeQ.isPending,
    metrics,
  };
}

function fmtMs(v: number | null): string {
  return v === null ? '—' : `${v} ms`;
}

/** A delta badge. `lowerIsBetter` → a "+" (increase) is a regression (destructive), "−" an improvement. */
function DeltaBadge({ delta, lowerIsBetter, unit }: { delta: Delta | null; lowerIsBetter: boolean; unit: string }) {
  if (!delta) return <span className="text-muted-foreground text-xs">·</span>;
  const better = lowerIsBetter ? delta.direction === '−' : delta.direction === '+';
  const variant = better ? 'success' : 'destructive';
  const pct = delta.percent === null ? '' : ` (${delta.percent.toFixed(0)}%)`;
  return (
    <Badge data-testid="delta-badge" variant={variant} className="font-mono text-xs">
      {delta.direction}
      {unit === '$' ? `$${delta.absolute.toFixed(4)}` : `${delta.absolute}${unit}`}
      {pct}
    </Badge>
  );
}

/** A compact per-lane timeline: one bar per visible span (reuses the M50 layout helpers). */
function LaneTimeline({ tree }: { tree: TraceSpanNode }) {
  const bounds = useMemo(() => computeTraceBounds(tree), [tree]);
  const flat = useMemo(() => flattenVisible(tree, EMPTY_COLLAPSED), [tree]);
  return (
    <ul className="space-y-1" aria-label="span timeline">
      {flat.map(({ node, depth }) => {
        const { leftPct, widthPct, unbounded } = computeBarLayout(
          node.startTimeUnixNano,
          node.endTimeUnixNano,
          bounds.startNs,
          bounds.endNs,
        );
        const isError = isErrorStatus(node.statusCode);
        return (
          <li key={node.spanId} className="flex items-center gap-2 text-xs">
            <span className="w-40 shrink-0 truncate font-mono" style={{ paddingLeft: `${depth * 8}px` }} title={node.name}>
              {node.name}
            </span>
            <span className="relative block h-3 min-w-[64px] flex-1 overflow-hidden rounded-sm bg-muted/30" aria-hidden="true">
              <span
                data-testid="span-bar"
                data-error={isError ? 'true' : undefined}
                data-unbounded={unbounded ? 'true' : undefined}
                style={{ left: `${leftPct}%`, width: `max(${widthPct}%, 2px)` }}
                className={`absolute top-0.5 bottom-0.5 rounded-sm ${isError ? 'bg-destructive' : 'bg-primary/60'} ${
                  unbounded ? 'border border-dashed border-primary/60 bg-transparent' : ''
                }`}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** One lane: header with the trace id + a status pill, its metrics, and the timeline (or an error). */
function Lane({ lane, label }: { lane: LaneData; label: string }) {
  if (lane.pending) return <Skeleton className="h-40 w-full" />;
  if (lane.treeError || !lane.tree) {
    return (
      <Alert intent="warning" title="Could not load this trace" data-testid={`lane-error-${lane.id}`}>
        <span className="font-mono">{lane.id}</span> is unavailable (not found in your workspace, or the lens service is
        down).
      </Alert>
    );
  }
  const m = lane.metrics!;
  return (
    <Card className="p-4" data-testid="compare-lane">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="outline">{label}</Badge>
        <span className="font-mono text-xs">{lane.id}</span>
        {m.hasError ? <Badge variant="destructive">error</Badge> : null}
      </div>
      <dl className="mb-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Duration</dt>
          <dd className="font-medium">{fmtMs(m.durationMs)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Tokens</dt>
          <dd className="font-medium">{m.tokens}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Cost</dt>
          <dd className="font-medium">
            {lane.costError ? (
              <span data-testid={`cost-degraded-${lane.id}`} title="cost unavailable">
                —
              </span>
            ) : (
              formatCost(m.costUsd ?? Number.NaN, 4)
            )}
          </dd>
        </div>
      </dl>
      <LaneTimeline tree={lane.tree} />
    </Card>
  );
}

/** The per-span delta table row. Matched → duration + tokens deltas + error markers; only-in → an
 *  honest marker with the delta suppressed (never a fabricated pairing). */
function DiffRow({ row }: { row: AlignRow }) {
  const name = row.a?.name ?? row.b?.name ?? '';
  if (row.status !== 'matched') {
    return (
      <tr className="border-t border-border/50">
        <td className="py-1 font-mono text-xs" style={{ paddingLeft: `${row.depth * 8}px` }}>
          {name}
        </td>
        <td className="py-1 text-xs" colSpan={3}>
          <Badge variant="outline">{row.status === 'only-in-a' ? 'only in A' : 'only in B'}</Badge>
        </td>
      </tr>
    );
  }
  const da = durationMs(row.a!);
  const db = durationMs(row.b!);
  const durDelta = numericDelta(db ?? undefined, da ?? undefined);
  const ta = spanTokens(row.a!);
  const tb = spanTokens(row.b!);
  const tokDelta = numericDelta(tb, ta);
  const errA = isErrorStatus(row.a!.statusCode);
  const errB = isErrorStatus(row.b!.statusCode);
  return (
    <tr className="border-t border-border/50">
      <td className="py-1 font-mono text-xs" style={{ paddingLeft: `${row.depth * 8}px` }}>
        {name}
        {errA || errB ? (
          <Badge variant="destructive" className="ml-1">
            {errA && errB ? 'error A+B' : errA ? 'error A' : 'error B'}
          </Badge>
        ) : null}
      </td>
      <td className="py-1 text-xs font-mono text-muted-foreground">
        {fmtMs(da)} → {fmtMs(db)} <DeltaBadge delta={durDelta} lowerIsBetter unit=" ms" />
      </td>
      <td className="py-1 text-xs font-mono text-muted-foreground">
        {ta} → {tb} <DeltaBadge delta={tokDelta} lowerIsBetter unit="" />
      </td>
    </tr>
  );
}

export function LensComparePage() {
  useRequireAuth();
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle?.('Compare traces'), [setPageTitle]);
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const [idA, idB] = ids;

  const laneA = useLane(idA);
  const laneB = useLane(idB);

  if (ids.length < 2) {
    return (
      <PageShell title="Compare traces" description="Pick two traces to compare their timelines and metrics.">
        <EmptyState
          title="Select two traces"
          description="Open the traces list, tick two rows, and choose Compare."
        />
      </PageShell>
    );
  }

  const bothLoaded = laneA.tree && laneB.tree;
  const align = bothLoaded ? alignSpanTrees(laneA.tree!, laneB.tree!) : null;

  // Root-level metric deltas (B vs A baseline).
  const mA = laneA.metrics;
  const mB = laneB.metrics;

  return (
    <PageShell title="Compare traces" description="Side-by-side timelines + a metrics delta. First trace is the baseline.">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Lane lane={laneA} label="A · baseline" />
          <Lane lane={laneB} label="B" />
        </div>

        {bothLoaded && mA && mB ? (
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Metrics delta (B vs A)</h2>
            <div className="mb-4 flex flex-wrap items-center gap-4 text-xs">
              <span className="flex items-center gap-1">
                Duration <DeltaBadge delta={numericDelta(mB.durationMs ?? undefined, mA.durationMs ?? undefined)} lowerIsBetter unit=" ms" />
              </span>
              <span className="flex items-center gap-1">
                Cost <DeltaBadge delta={numericDelta(mB.costUsd ?? undefined, mA.costUsd ?? undefined)} lowerIsBetter unit="$" />
              </span>
              <span className="flex items-center gap-1">
                Tokens <DeltaBadge delta={numericDelta(mB.tokens, mA.tokens)} lowerIsBetter unit="" />
              </span>
            </div>

            {align && !align.comparable ? (
              <Alert intent="warning" title="Structurally different" className="mb-3">
                These traces have different span structures — spans present on only one side are marked
                below and their deltas are suppressed (no fabricated 1:1 diff).
              </Alert>
            ) : null}

            {/* A bespoke <table> (not @usetheo/ui DataTable): the diff needs per-row colSpan for the
                "only in A/B" markers + a depth indent per span — a shape DataTable's uniform-column
                model does not express. The tabular primitive is still standard HTML (Rule 9 applies to
                reusable widgets, not to a one-off diff layout). */}
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="pb-1 font-medium">Span</th>
                  <th className="pb-1 font-medium">Duration (A → B)</th>
                  <th className="pb-1 font-medium">Tokens (A → B)</th>
                </tr>
              </thead>
              <tbody>
                {align!.rows.map((row, i) => (
                  // key qualified by position+depth: `row.key` is only level-local, so the same
                  // name+kind+ordinal under different parents would otherwise collide (real for agent
                  // traces with repeated span names across branches).
                  <DiffRow key={`${i}-${row.depth}-${row.status}-${row.key}`} row={row} />
                ))}
              </tbody>
            </table>
          </Card>
        ) : null}
      </div>
    </PageShell>
  );
}
