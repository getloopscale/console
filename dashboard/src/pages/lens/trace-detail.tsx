import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Alert, Badge, Button, Card, Skeleton } from '@usetheo/ui';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';

import { cloudFetch } from '@/lib/api';

/**
 * M47/M48 — the trace-detail view. Fetches the reconstructed span tree from the read BFF
 * (`GET /v1/dashboard/lens/traces/{id}` → theo-lens `GET /v1/traces/:id`) and renders a resizable
 * two-pane: left = the span tree (recursive below a threshold, react-virtual VIRTUALIZED above it —
 * M48); right = the selected span's input/output (chat-message arrays role-rendered; JSON/text in a
 * read-only CodeMirror with folding — M48; `<REDACTED>`/oversized handled as data) + attributes +
 * events + model/provider/tokens/ttft/latency. Borrows the converged SOTA structure + libs
 * (langfuse/phoenix/laminar/opik) — `@tanstack/react-virtual` (already installed, reused), CodeMirror,
 * `react-resizable-panels`. Escaped-text render only, never `dangerouslySetInnerHTML` (the XSS guard;
 * CodeMirror renders the value as document text, not HTML). See
 * `.claude/knowledge-base/discoveries/blueprints/trace-viewer-scale-rich-blueprint.md`.
 */

interface TraceSpanNode {
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

interface ChatMessage {
  role: string;
  content: unknown;
}

interface FlatNode {
  node: TraceSpanNode;
  depth: number;
}

const REDACTED = '<REDACTED>';
const MAX_VALUE_CHARS = 2000;
// Above this many visible rows, switch from the recursive render to the react-virtual flat-list.
// Our Claude Code agent traces are small (a handful of spans), so the common path stays recursive;
// virtualization engages only when it earns its complexity (blueprint D2; langfuse uses 350).
export const VIRTUALIZE_THRESHOLD = 200;

// ---- pure helpers (exported for unit tests) ----

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

// ---- value rendering ----

function ChatView({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="space-y-2" data-testid="chat-view">
      {messages.map((m, i) => (
        <div key={i} className="rounded-md border p-2">
          <Badge variant="outline" className="mb-1">
            {m.role}
          </Badge>
          <pre className="whitespace-pre-wrap break-words text-xs">
            {typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

/** Read-only, syntax-highlighted, foldable JSON/text via CodeMirror (M48). Renders text as document,
 * never HTML — the XSS guard holds. */
function JsonView({ text, testId }: { text: string; testId?: string }) {
  return (
    <div data-testid={testId} className="overflow-hidden rounded-md border">
      <CodeMirror
        value={text}
        editable={false}
        basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
        extensions={[json(), EditorView.lineWrapping, EditorState.readOnly.of(true)]}
      />
    </div>
  );
}

/** Escaped-render a span input/output value; redacted markers, chat arrays and oversized values are
 * DATA. Normal-size JSON/text renders in CodeMirror (M48); oversized keeps the M47 `<pre>` +
 * show-more (a full editor over 20k chars is pointless and the truncation contract is preserved). */
function ValueBlock({ value, testId }: { value?: string; testId?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (value === undefined || value === null || value === '') {
    return <p className="text-xs text-muted-foreground">—</p>;
  }
  if (value === REDACTED) {
    return (
      <p className="text-xs text-muted-foreground" data-testid={testId}>
        Redacted by the client (prompt logging is off).
      </p>
    );
  }
  const chat = asChat(value);
  if (chat) {
    return (
      <div data-testid={testId}>
        <ChatView messages={chat} />
      </div>
    );
  }
  const text = prettyValue(value);
  const oversized = text.length > MAX_VALUE_CHARS;
  if (oversized) {
    const shown = expanded ? text : text.slice(0, MAX_VALUE_CHARS);
    return (
      <div className="space-y-1">
        <pre
          data-testid={testId}
          className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-xs"
        >
          {shown}
        </pre>
        <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : `Show more (${text.length - MAX_VALUE_CHARS} more chars)`}
        </Button>
      </div>
    );
  }
  return <JsonView text={text} testId={testId} />;
}

// ---- tree rendering ----

/**
 * The M50 waterfall lane for one span: a positioned bar sized by `computeBarLayout`, colored with an
 * error override (laminar), floored to a clickable min-width, dashed when unbounded (missing end).
 * PRESENTATIONAL — it lives INSIDE the row's select button, so a click anywhere on the lane selects
 * the span (row-level selection, shared with the tree; no second interactive element to collide with
 * the tree row's accessible name). Styles + `title` text only — never `dangerouslySetInnerHTML`.
 */
function TimelineBar({ node, bounds }: { node: TraceSpanNode; bounds: { startNs: bigint; endNs: bigint } }) {
  const { leftPct, widthPct, unbounded } = computeBarLayout(
    node.startTimeUnixNano,
    node.endTimeUnixNano,
    bounds.startNs,
    bounds.endNs,
  );
  const dur = durationMs(node);
  const isError = !!node.statusCode && node.statusCode !== '0';
  const tip = `${node.name} · ${dur !== null ? `${dur} ms` : 'in-flight'}${node.model ? ` · ${node.model}` : ''}`;
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
}: {
  node: TraceSpanNode;
  depth: number;
  selected: boolean;
  collapsed: boolean;
  bounds: { startNs: bigint; endNs: bigint };
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  selectedRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const dur = durationMs(node);
  const hasChildren = (node.children?.length ?? 0) > 0;
  return (
    <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 16}px` }}>
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
        {dur !== null ? <span className="shrink-0 text-xs text-muted-foreground">{dur} ms</span> : null}
        {node.model ? (
          <Badge variant="outline" className="shrink-0">
            {node.model}
          </Badge>
        ) : null}
        {node.inputTokens !== undefined || node.outputTokens !== undefined ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {node.inputTokens ?? 0}→{node.outputTokens ?? 0}
          </span>
        ) : null}
        {node.statusCode && node.statusCode !== '0' ? (
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
function RecursiveTree({
  node,
  depth,
  selectedId,
  collapsed,
  bounds,
  onSelect,
  onToggle,
  selectedRef,
}: {
  node: TraceSpanNode;
  depth: number;
  selectedId: string;
  collapsed: Set<string>;
  bounds: { startNs: bigint; endNs: bigint };
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  selectedRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const isCollapsed = collapsed.has(node.spanId);
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
      />
      {!isCollapsed
        ? (node.children ?? []).map((c, i) => (
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
            />
          ))
        : null}
    </div>
  );
}

/** Virtualized flat-list tree (large traces — at/above the threshold), reusing @tanstack/react-virtual. */
function VirtualTree({
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
  bounds: { startNs: bigint; endNs: bigint };
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
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Right pane — everything the user came for about ONE span. */
function SpanDetail({ span }: { span: TraceSpanNode }) {
  const dur = durationMs(span);
  const attrs = Object.entries(span.attributes ?? {});
  const events = span.events ?? [];
  return (
    <div data-testid="span-detail" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{span.name}</span>
        {span.model ? <Badge variant="outline">{span.model}</Badge> : null}
        {span.provider ? <Badge variant="outline">{span.provider}</Badge> : null}
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {span.inputTokens !== undefined ? (
          <div>
            <dt className="text-muted-foreground">Input tokens</dt>
            <dd className="font-medium">{span.inputTokens}</dd>
          </div>
        ) : null}
        {span.outputTokens !== undefined ? (
          <div>
            <dt className="text-muted-foreground">Output tokens</dt>
            <dd className="font-medium">{span.outputTokens}</dd>
          </div>
        ) : null}
        {span.ttftMs !== undefined ? (
          <div>
            <dt className="text-muted-foreground">TTFT</dt>
            <dd className="font-medium">{span.ttftMs} ms</dd>
          </div>
        ) : null}
        {dur !== null ? (
          <div>
            <dt className="text-muted-foreground">Latency</dt>
            <dd className="font-medium">{dur} ms</dd>
          </div>
        ) : null}
      </dl>

      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Input</h3>
        <ValueBlock key={`in-${span.spanId}`} value={span.inputValue} testId="span-input" />
      </section>
      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Output</h3>
        <ValueBlock key={`out-${span.spanId}`} value={span.outputValue} testId="span-output" />
      </section>

      {attrs.length > 0 ? (
        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Attributes</h3>
          <dl className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            {attrs.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="shrink-0 font-mono text-muted-foreground">{k}</dt>
                <dd className="truncate font-mono">{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
              </div>
            ))}
          </dl>
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

export function LensTraceDetail({ traceId }: { traceId: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const selectedRef = useRef<HTMLButtonElement>(null);
  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/traces', traceId, 'tree'] as const,
    queryFn: () => cloudFetch<TraceSpanNode>(`/v1/dashboard/lens/traces/${encodeURIComponent(traceId)}`),
  });

  const root = query.data;
  const activeId = selectedId ?? root?.spanId ?? null;

  const flat = useMemo(() => (root ? flattenVisible(root, collapsed) : []), [root, collapsed]);
  // M50 — trace time bounds (memoized once) drive every waterfall bar's denominator.
  const bounds = useMemo(() => (root ? computeTraceBounds(root) : { startNs: 0n, endNs: 0n }), [root]);

  // Scroll-to-selected for the recursive path (the virtual path scrolls via the virtualizer).
  useEffect(() => {
    const el = selectedRef.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  if (query.isPending) return <Skeleton className="h-40 w-full" />;
  if (query.isError || !root) {
    return (
      <Alert intent="warning" title="Could not load this trace">
        The lens service is unavailable. Try again shortly.
      </Alert>
    );
  }

  const resolvedId = activeId ?? root.spanId;
  const selected = flattenAll(root).find((s) => s.spanId === resolvedId) ?? root;
  const virtualized = flat.length >= VIRTUALIZE_THRESHOLD;

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
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
                  selectedId={resolvedId}
                  collapsed={collapsed}
                  bounds={bounds}
                  onSelect={setSelectedId}
                  onToggle={toggle}
                />
              ) : (
                <RecursiveTree
                  node={root}
                  depth={0}
                  selectedId={resolvedId}
                  collapsed={collapsed}
                  bounds={bounds}
                  onSelect={setSelectedId}
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
  );
}
