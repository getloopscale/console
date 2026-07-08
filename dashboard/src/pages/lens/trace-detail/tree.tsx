import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, ClipboardCheck } from 'lucide-react';
import { Badge, Button } from '@usetheo/ui';

import { cloudFetch } from '@/lib/api';
import { LensPlayground } from '../playground';
import { Attributes } from './attributes';
import { IoCards } from './io-cards';
import { formatDuration, formatTokens } from '@/lib/format';
import { isSpanError } from '@/lib/span-status';
import { computeBarLayout, durationMs, type FlatNode, type TraceSpanNode } from './helpers';

/**
 * Presentational view components for the trace-detail screen (M58 D1 split out of the composition
 * root `./index`). Escaped-text render only — the IO body goes through the sanitized `Markdown` wrapper
 * and raw JSON stays in CodeMirror `readOnly` (document text, never HTML — the XSS guard, M48/M58 P3).
 * No I/O and no URL access here; selection is passed in via `selectedId` + callbacks.
 */

type Bounds = { startNs: bigint; endNs: bigint };

// ---- tree rendering ----

/** The M50 waterfall lane for one span: a positioned bar sized by `computeBarLayout`. Presentational. */
function TimelineBar({ node, bounds }: { node: TraceSpanNode; bounds: Bounds }) {
  const { leftPct, widthPct, unbounded } = computeBarLayout(
    node.startTimeUnixNano,
    node.endTimeUnixNano,
    bounds.startNs,
    bounds.endNs,
  );
  const dur = durationMs(node);
  const isError = isSpanError(node.statusCode);
  const tip = `${node.name} · ${dur !== null ? formatDuration(dur) : 'in-flight'}${node.model ? ` · ${node.model}` : ''}`;
  return (
    <span
      className="relative ml-2 block h-4 min-w-[64px] flex-1 overflow-hidden rounded-sm bg-muted/30"
      aria-hidden="true"
    >
      <span
        data-testid="span-bar"
        data-error={isError ? 'true' : undefined}
        data-unbounded={unbounded ? 'true' : undefined}
        title={tip}
        style={{ left: `${leftPct}%`, width: `max(${widthPct}%, 2px)` }}
        className={`absolute top-0.5 bottom-0.5 rounded-sm ${
          isError ? 'bg-destructive' : 'bg-primary/60'
        } ${unbounded ? 'border border-dashed border-primary/60 bg-transparent' : ''}`}
      />
    </span>
  );
}

/** The single clickable row for a span — shared by the recursive and virtualized render paths. */
function SpanRow({
  node,
  depth,
  selected,
  collapsed,
  bounds,
  onSelect,
  onToggle,
  selectedRef,
  posinset = 1,
  setsize = 1,
}: {
  node: TraceSpanNode;
  depth: number;
  selected: boolean;
  collapsed: boolean;
  bounds: Bounds;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  selectedRef?: React.RefObject<HTMLButtonElement | null>;
  posinset?: number;
  setsize?: number;
}) {
  const dur = durationMs(node);
  const hasChildren = (node.children?.length ?? 0) > 0;
  return (
    // M71 — real ARIA tree semantics: a treeitem carries its level + sibling position + expansion +
    // selection so a screen reader announces the trace's shape (was a plain nested <div>).
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-posinset={posinset}
      aria-setsize={setsize}
      aria-selected={selected}
      aria-expanded={hasChildren ? !collapsed : undefined}
      className="flex items-center gap-2"
      style={{ paddingLeft: `${depth * 16}px` }}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-label={collapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
          aria-expanded={!collapsed}
          onClick={() => onToggle(node.spanId)}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted/50"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      ) : (
        <span className="w-4 shrink-0" aria-hidden="true" />
      )}
      <button
        type="button"
        ref={selected ? selectedRef : undefined}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(node.spanId)}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pr-2 text-left text-sm hover:bg-muted/50 ${
          selected ? 'bg-muted font-medium' : ''
        }`}
      >
        <span className="min-w-0 truncate font-mono text-xs">{node.name}</span>
        {dur !== null ? <span className="shrink-0 text-xs text-muted-foreground">{formatDuration(dur)}</span> : null}
        {node.model ? (
          <Badge variant="outline" className="shrink-0">
            {node.model}
          </Badge>
        ) : null}
        {node.inputTokens !== undefined || node.outputTokens !== undefined ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatTokens(node.inputTokens ?? 0)}→{formatTokens(node.outputTokens ?? 0)}
          </span>
        ) : null}
        {isSpanError(node.statusCode) ? (
          <Badge variant="destructive" className="shrink-0">
            error
          </Badge>
        ) : null}
        <TimelineBar node={node} bounds={bounds} />
      </button>
    </div>
  );
}

/** Recursive tree (small traces — below the virtualization threshold). */
export function RecursiveTree({
  node,
  depth,
  selectedId,
  collapsed,
  bounds,
  onSelect,
  onToggle,
  selectedRef,
  posinset = 1,
  setsize = 1,
}: {
  node: TraceSpanNode;
  depth: number;
  selectedId: string;
  collapsed: Set<string>;
  bounds: Bounds;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  selectedRef: React.RefObject<HTMLButtonElement | null>;
  posinset?: number;
  setsize?: number;
}) {
  const isCollapsed = collapsed.has(node.spanId);
  const children = node.children ?? [];
  return (
    <div>
      <SpanRow
        node={node}
        depth={depth}
        selected={node.spanId === selectedId}
        collapsed={isCollapsed}
        bounds={bounds}
        onSelect={onSelect}
        onToggle={onToggle}
        selectedRef={selectedRef}
        posinset={posinset}
        setsize={setsize}
      />
      {!isCollapsed
        ? children.map((c, i) => (
            <RecursiveTree
              key={`${i}-${c.spanId}`}
              node={c}
              depth={depth + 1}
              selectedId={selectedId}
              collapsed={collapsed}
              bounds={bounds}
              onSelect={onSelect}
              onToggle={onToggle}
              selectedRef={selectedRef}
              posinset={i + 1}
              setsize={children.length}
            />
          ))
        : null}
    </div>
  );
}

/** Virtualized flat-list tree (large traces — at/above the threshold), reusing @tanstack/react-virtual. */
export function VirtualTree({
  flat,
  selectedId,
  collapsed,
  bounds,
  onSelect,
  onToggle,
}: {
  flat: FlatNode[];
  selectedId: string;
  collapsed: Set<string>;
  bounds: Bounds;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 20,
    // A default viewport so rows render before the real ResizeObserver measures the scroll element
    // (SSR/jsdom have no layout). The real observer overrides this in the browser.
    initialRect: { width: 320, height: 640 },
  });

  // Scroll the selected row into view.
  useEffect(() => {
    const index = flat.findIndex((f) => f.node.spanId === selectedId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'center', behavior: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return (
    <div ref={parentRef} data-testid="span-tree-virtual" className="max-h-[70vh] overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const { node, depth } = flat[vi.index];
          return (
            <div
              key={`${vi.index}-${node.spanId}`}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
            >
              <SpanRow
                node={node}
                depth={depth}
                selected={node.spanId === selectedId}
                collapsed={collapsed.has(node.spanId)}
                bounds={bounds}
                onSelect={onSelect}
                onToggle={onToggle}
                posinset={vi.index + 1}
                setsize={flat.length}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Right pane — everything the user came for about ONE span. */
export function SpanDetail({ span }: { span: TraceSpanNode }) {
  const dur = durationMs(span);
  const hasAttrs = Object.keys(span.attributes ?? {}).length > 0;
  const events = span.events ?? [];
  // M55 — an LLM span (one with a recorded input) can be replayed in the playground.
  const canReplay = !!span.inputValue;
  const [pgOpen, setPgOpen] = useState(false);
  // M63 — the single per-span entry-point to the labeling queue (enqueue for human review). One
  // affordance (ADR D5); NOT a duplicate of the M44 tags/annotations panel (a distinct flow).
  const enqueue = useMutation({
    mutationFn: () =>
      cloudFetch(
        `/v1/dashboard/lens/traces/${encodeURIComponent(span.traceId)}/enqueue-for-labeling`,
        { method: 'POST', body: JSON.stringify({ spanId: span.spanId }) },
        { throwOnError: true },
      ),
    retry: false,
  });
  return (
    <div data-testid="span-detail" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{span.name}</span>
        {span.model ? <Badge variant="outline">{span.model}</Badge> : null}
        {span.provider ? <Badge variant="outline">{span.provider}</Badge> : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          aria-label={`Add ${span.name} to labeling queue`}
          disabled={enqueue.isPending || enqueue.isSuccess}
          onClick={() => enqueue.mutate()}
        >
          <ClipboardCheck className="mr-1 h-4 w-4" />
          {enqueue.isSuccess ? 'Queued' : enqueue.isPending ? 'Queuing…' : 'Add to labeling queue'}
        </Button>
        {canReplay ? (
          <Button variant="secondary" size="sm" onClick={() => setPgOpen((v) => !v)}>
            {pgOpen ? 'Close playground' : 'Playground'}
          </Button>
        ) : null}
      </div>
      {enqueue.isError ? (
        <Badge variant="destructive" data-testid="enqueue-error">
          Could not add to queue
        </Badge>
      ) : null}
      {canReplay && pgOpen ? <LensPlayground span={span} /> : null}

      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {span.inputTokens !== undefined ? (
          <div>
            <dt className="text-muted-foreground">Input tokens</dt>
            <dd className="font-medium">{formatTokens(span.inputTokens ?? 0)}</dd>
          </div>
        ) : null}
        {span.outputTokens !== undefined ? (
          <div>
            <dt className="text-muted-foreground">Output tokens</dt>
            <dd className="font-medium">{formatTokens(span.outputTokens ?? 0)}</dd>
          </div>
        ) : null}
        {span.ttftMs !== undefined ? (
          <div>
            <dt className="text-muted-foreground">TTFT</dt>
            <dd className="font-medium">{formatDuration(span.ttftMs ?? 0)}</dd>
          </div>
        ) : null}
        {dur !== null ? (
          <div>
            <dt className="text-muted-foreground">Latency</dt>
            <dd className="font-medium">{formatDuration(dur)}</dd>
          </div>
        ) : null}
      </dl>

      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Input</h3>
        <IoCards key={`in-${span.spanId}`} value={span.inputValue} testId="span-input" />
      </section>
      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Output</h3>
        <IoCards key={`out-${span.spanId}`} value={span.outputValue} testId="span-output" />
      </section>

      {hasAttrs ? (
        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Attributes</h3>
          {/* M58 P2.2 — namespace-grouped, PII-masked panel. `canReveal` is fail-closed (false) for
              now; the raw PII value never enters the DOM pre-reveal.
              TODO: thread from Principal scope (an `observability:*` session claim) once wired. */}
          <Attributes attrs={span.attributes} canReveal={false} />
        </section>
      ) : null}

      {events.length > 0 ? (
        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Events</h3>
          <ul className="space-y-1 text-xs">
            {events.map((e, i) => (
              <li key={`${e.name}-${i}`} className="font-mono">
                {e.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
