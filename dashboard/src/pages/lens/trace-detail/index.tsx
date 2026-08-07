import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  computeTraceBounds as uiComputeTraceBounds,
  EmptyState,
  Skeleton,
  SpanGraph,
  SpanTree,
  SpanWaterfall,
  TraceTranscript,
} from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

import { cloudFetch } from '@/lib/http/api';

import { flattenAll, flattenVisible, type TraceSpanNode } from './helpers';
import { Breadcrumb, useSelection, useSpanKeyboardNav } from './breadcrumb';
import { SpanDetail } from './span-detail';
import { toTraceSpan } from './to-trace-span';
import { traceSummary } from './summary';
import { formatCost, formatDuration, formatNumber, formatTokens } from '@/lib/formatting/format';

/**
 * M47/M48/M58 — the trace-detail view composition root. Fetches the reconstructed span tree from the
 * read BFF (`GET /v1/dashboard/lens/traces/{id}` → theo-lens `GET /v1/traces/:id`) and renders a
 * resizable two-pane: left = the span tree (recursive below a threshold, react-virtual VIRTUALIZED
 * above it — M48) with a breadcrumb; right = the selected span's detail. M58 Phase 0: the URL query
 * (`?spanId=&tab=&view=`) is the single source of truth for selection (ADR D3) — the tree, the
 * breadcrumb, and keyboard `]`/`[` next/prev all read/write it.
 *
 * The pure helpers + `TraceSpanNode` live in `./helpers`; the presentational tree/detail components
 * live in `./tree`. The old `../trace-detail.tsx` is now a D1 re-export shim so existing imports
 * (`trace-detail.test.tsx`, `compare.tsx`, `playground.tsx`) keep resolving.
 */

/** One segment of the Tree ⇄ Transcript ⇄ Graph view toggle. */
function ViewToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button type="button" size="sm" variant={active ? 'secondary' : 'ghost'} aria-pressed={active} onClick={onClick}>
      {label}
    </Button>
  );
}

export function LensTraceDetail({ traceId }: { traceId: string }) {
  const { spanId, view, setSelection } = useSelection(traceId);
  // M58 P4.2 — the Tree ⇄ Transcript toggle (M67 adds Graph). The URL `?view=` is the source of truth
  // (ADR D2/D3); default `tree`. `transcript` swaps the left lane for the reader-mode feed; `graph`
  // swaps it for the M67 agent execution graph.
  const isTranscript = view === 'transcript';
  const isGraph = view === 'graph';
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/traces', traceId, 'tree'] as const,
    queryFn: () => cloudFetch<TraceSpanNode>(`/v1/dashboard/lens/traces/${encodeURIComponent(traceId)}`, {}, { throwOnError: true }),
  });

  const root = query.data;

  // M8 adoption — map the OTLP-shaped lens node to the @usetheo/ui generic TraceSpan once per fetch.
  // The kit components (SpanTree/SpanWaterfall/TraceTranscript/SpanGraph) consume the mapped tree; the
  // URL/selection/keyboard logic below stays in the consumer (the DS receives data, never routes).
  const uiRoot = useMemo(() => (root ? toTraceSpan(root) : null), [root]);
  const bounds = useMemo(
    () => (uiRoot ? uiComputeTraceBounds(uiRoot) : { startNs: 0n, endNs: 0n }),
    [uiRoot],
  );

  // M58 P0 — the URL is the source of truth for selection. Resolve the requested span; a missing or
  // stale (unknown) `spanId` falls back to the root, so a shared deep-link never crashes.
  const allIds = useMemo(() => (root ? flattenAll(root).map((s) => s.spanId) : []), [root]);
  const resolvedId = root ? (spanId && allIds.includes(spanId) ? spanId : root.spanId) : null;

  // Keyboard next/prev over the VISIBLE order (collapsed subtrees are skipped) — writes the URL.
  const visibleIds = useMemo(
    () => (root ? flattenVisible(root, collapsed).map((f) => f.node.spanId) : []),
    [root, collapsed],
  );
  useSpanKeyboardNav(visibleIds, resolvedId ?? '', (next) => setSelection({ spanId: next }));

  if (query.isPending) return <Skeleton className="h-40 w-full" />;
  // M57 T5.1 — distinguish an error (service unavailable) from an honest empty
  // result (the fetch succeeded but the trace carries no spans).
  if (query.isError) {
    return (
      <Alert intent="warning" title="Could not load this trace">
        The lens service is unavailable. Try again shortly.
      </Alert>
    );
  }
  if (!root) {
    return (
      <EmptyState
        title="No spans in this trace"
        description="This trace was recorded but carries no spans to display."
      />
    );
  }

  const selectedResolvedId = resolvedId ?? root.spanId;
  const selected = flattenAll(root).find((s) => s.spanId === selectedResolvedId) ?? root;
  const onSelect = (id: string) => setSelection({ spanId: id });
  const onToggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // `uiRoot` is non-null here (guarded by `!root` above).
  const treeRoot = uiRoot as NonNullable<typeof uiRoot>;

  // Shared props for the kit's controlled trace components (kills per-view prop duplication).
  const controlled = { selectedId: selectedResolvedId, onSelect } as const;

  return (
    <div className="space-y-2">
      <Breadcrumb root={root} selectedId={selectedResolvedId} onSelect={onSelect} />
      {/* M72 — the trace-level headline the detail view was missing: total duration / ∑ cost / ∑ tokens
          / error count / distinct models. Absent duration → em-dash; sums of zero are honest. */}
      {(() => {
        const s = traceSummary(root);
        return (
          <dl data-testid="trace-summary" className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <div className="flex gap-1"><dt className="text-muted-foreground">Duration</dt><dd className="font-medium tabular-nums">{s.durationMs !== null ? formatDuration(s.durationMs) : '—'}</dd></div>
            <div className="flex gap-1"><dt className="text-muted-foreground">Cost</dt><dd className="font-medium tabular-nums">{formatCost(s.costUsd)}</dd></div>
            <div className="flex gap-1"><dt className="text-muted-foreground">Tokens</dt><dd className="font-medium tabular-nums">{formatTokens(s.totalTokens)}</dd></div>
            <div className="flex gap-1"><dt className="text-muted-foreground">Errors</dt><dd className={`font-medium tabular-nums ${s.errorCount > 0 ? 'text-destructive' : ''}`}>{formatNumber(s.errorCount, 'grouped')}</dd></div>
            <div className="flex gap-1"><dt className="text-muted-foreground">Models</dt><dd className="font-medium">{s.models.length > 0 ? s.models.join(', ') : '—'}</dd></div>
          </dl>
        );
      })()}
      <PanelGroup direction="horizontal" autoSaveId="lens-trace-split" className="gap-2">
        <Panel defaultSize={40} minSize={20}>
          <Card className="h-full">
            <Card.Body>
              {/* M58/M67 — the Tree ⇄ Transcript ⇄ Graph segmented toggle (writes ?view=). */}
              <div role="group" aria-label="View mode" className="mb-2 inline-flex gap-1">
                <ViewToggle label="Tree" active={!isTranscript && !isGraph} onClick={() => setSelection({ view: 'tree' })} />
                <ViewToggle label="Transcript" active={isTranscript} onClick={() => setSelection({ view: 'transcript' })} />
                <ViewToggle label="Graph" active={isGraph} onClick={() => setSelection({ view: 'graph' })} />
              </div>
              {isGraph ? (
                <SpanGraph root={treeRoot} {...controlled} />
              ) : isTranscript ? (
                <TraceTranscript
                  root={treeRoot}
                  {...controlled}
                  collapsedGroups={collapsed}
                  onToggleGroup={onToggleCollapse}
                />
              ) : (
                <div data-testid="span-tree" className="max-h-[70vh] overflow-auto">
                  <SpanTree
                    root={treeRoot}
                    {...controlled}
                    collapsed={collapsed}
                    onToggleCollapse={onToggleCollapse}
                    bounds={bounds}
                  />
                </div>
              )}
            </Card.Body>
          </Card>
        </Panel>
        <PanelResizeHandle
          aria-label="Resize trace panels"
          className="w-1.5 shrink-0 rounded bg-border transition-colors hover:bg-primary/40"
        />
        <Panel defaultSize={60} minSize={30}>
          <Card className="h-full">
            <Card.Body>
              <SpanDetail span={selected} />
            </Card.Body>
          </Card>
        </Panel>
      </PanelGroup>
      {/* M58 T1.2 — the polished waterfall timeline lane (nice axis, hover-needle, ∑ parent cost). */}
      <Card>
        <Card.Body>
          <SpanWaterfall root={treeRoot} bounds={bounds} {...controlled} collapsed={collapsed} />
        </Card.Body>
      </Card>
    </div>
  );
}
