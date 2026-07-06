import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, EmptyState, Skeleton } from '@usetheo/ui';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

import { cloudFetch } from '@/lib/api';

import {
  computeTraceBounds,
  flattenAll,
  flattenVisible,
  VIRTUALIZE_THRESHOLD,
  type TraceSpanNode,
} from './helpers';
import { Breadcrumb, useSelection, useSpanKeyboardNav } from './breadcrumb';
import { RecursiveTree, SpanDetail, VirtualTree } from './tree';
import { Waterfall } from './waterfall';

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
 * (`trace-detail.test.tsx`, `compare.tsx`, `compare-core.ts`, `playground.tsx`) keep resolving.
 */

export function LensTraceDetail({ traceId }: { traceId: string }) {
  const { spanId, setSelection } = useSelection(traceId);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const selectedRef = useRef<HTMLButtonElement>(null);
  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/traces', traceId, 'tree'] as const,
    queryFn: () => cloudFetch<TraceSpanNode>(`/v1/dashboard/lens/traces/${encodeURIComponent(traceId)}`),
  });

  const root = query.data;

  const flat = useMemo(() => (root ? flattenVisible(root, collapsed) : []), [root, collapsed]);
  // M50 — trace time bounds (memoized once) drive every waterfall bar's denominator.
  const bounds = useMemo(() => (root ? computeTraceBounds(root) : { startNs: 0n, endNs: 0n }), [root]);

  // M58 P0 — the URL is the source of truth for selection. Resolve the requested span; a missing or
  // stale (unknown) `spanId` falls back to the root, so a shared deep-link never crashes.
  const allIds = useMemo(() => (root ? flattenAll(root).map((s) => s.spanId) : []), [root]);
  const resolvedId = root ? (spanId && allIds.includes(spanId) ? spanId : root.spanId) : null;

  // Keyboard next/prev over the VISIBLE order (collapsed subtrees are skipped) — writes the URL.
  const visibleIds = useMemo(() => flat.map((f) => f.node.spanId), [flat]);
  useSpanKeyboardNav(visibleIds, resolvedId ?? '', (next) => setSelection({ spanId: next }));

  // Scroll-to-selected for the recursive path (the virtual path scrolls via the virtualizer).
  useEffect(() => {
    const el = selectedRef.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [resolvedId]);

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
  const virtualized = flat.length >= VIRTUALIZE_THRESHOLD;
  const onSelect = (id: string) => setSelection({ spanId: id });

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-2">
      <Breadcrumb root={root} selectedId={selectedResolvedId} onSelect={onSelect} />
      <PanelGroup direction="horizontal" autoSaveId="lens-trace-split" className="gap-2">
        <Panel defaultSize={40} minSize={20}>
          <Card className="h-full">
            <Card.Body>
              <div
                data-testid="span-tree"
                className={virtualized ? 'space-y-0.5' : 'max-h-[70vh] space-y-0.5 overflow-auto'}
              >
                {virtualized ? (
                  <VirtualTree
                    flat={flat}
                    selectedId={selectedResolvedId}
                    collapsed={collapsed}
                    bounds={bounds}
                    onSelect={onSelect}
                    onToggle={toggle}
                  />
                ) : (
                  <RecursiveTree
                    node={root}
                    depth={0}
                    selectedId={selectedResolvedId}
                    collapsed={collapsed}
                    bounds={bounds}
                    onSelect={onSelect}
                    onToggle={toggle}
                    selectedRef={selectedRef}
                  />
                )}
              </div>
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
          <Waterfall
            root={root}
            bounds={bounds}
            selectedId={selectedResolvedId}
            collapsed={collapsed}
            onSelect={onSelect}
          />
        </Card.Body>
      </Card>
    </div>
  );
}
