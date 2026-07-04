import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Alert, Badge, Button, Card, Skeleton } from '@usetheo/ui';

import { cloudFetch } from '@/lib/api';

/**
 * M47 — the trace-detail view. Fetches the reconstructed span tree from the read BFF
 * (`GET /v1/dashboard/lens/traces/{id}` → theo-lens `GET /v1/traces/:id`) and renders a two-pane:
 * left = the recursive span tree (expand/collapse, scroll-to-selected); right = the selected span's
 * input/output (chat-message arrays role-rendered, else pretty-JSON) + attributes + events +
 * model/provider/tokens/ttft/latency. Borrows the converged SOTA structure (langfuse/phoenix/
 * laminar/opik) but adds ZERO runtime deps — recursive render (no react-virtual; our agent traces
 * are far below langfuse's 350-span virtualization threshold) and escaped-text render (never
 * `dangerouslySetInnerHTML` — the XSS guard). See
 * `.claude/knowledge-base/discoveries/blueprints/trace-detail-view-blueprint.md`.
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

const REDACTED = '<REDACTED>';
const MAX_VALUE_CHARS = 2000;

// ---- pure helpers (exported for unit tests) ----

/** Span duration in ms from the unix-nano timestamps; null when unavailable or clock-skewed (end < start). */
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

/** Depth-first flatten so a selected span can be resolved by id. */
function flatten(root: TraceSpanNode): TraceSpanNode[] {
  const out: TraceSpanNode[] = [root];
  for (const c of root.children ?? []) out.push(...flatten(c));
  return out;
}

// ---- rendering ----

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

/** Escaped-render a span input/output value; redacted markers, chat arrays and oversized values are DATA. */
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
  const shown = oversized && !expanded ? text.slice(0, MAX_VALUE_CHARS) : text;
  return (
    <div className="space-y-1">
      <pre
        data-testid={testId}
        className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-xs"
      >
        {shown}
      </pre>
      {oversized ? (
        <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : `Show more (${text.length - MAX_VALUE_CHARS} more chars)`}
        </Button>
      ) : null}
    </div>
  );
}

/** One row in the recursive span tree. */
function SpanNode({
  node,
  depth,
  selectedId,
  collapsed,
  onSelect,
  onToggle,
  selectedRef,
}: {
  node: TraceSpanNode;
  depth: number;
  selectedId: string;
  collapsed: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  selectedRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const dur = durationMs(node);
  const selected = node.spanId === selectedId;
  const children = node.children ?? [];
  const isCollapsed = collapsed.has(node.spanId);
  return (
    <div>
      <div className="flex items-center" style={{ paddingLeft: `${depth * 16}px` }}>
        {children.length > 0 ? (
          <button
            type="button"
            aria-label={isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
            aria-expanded={!isCollapsed}
            onClick={() => onToggle(node.spanId)}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted/50"
          >
            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
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
          <span className="truncate font-mono text-xs">{node.name}</span>
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
        </button>
      </div>
      {!isCollapsed
        ? children.map((c) => (
            <SpanNode
              key={c.spanId}
              node={c}
              depth={depth + 1}
              selectedId={selectedId}
              collapsed={collapsed}
              onSelect={onSelect}
              onToggle={onToggle}
              selectedRef={selectedRef}
            />
          ))
        : null}
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

  const activeId = selectedId ?? query.data?.spanId ?? null;

  // Scroll-to-selected: bring the active node into view when the selection changes.
  useEffect(() => {
    const el = selectedRef.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  if (query.isPending) return <Skeleton className="h-40 w-full" />;
  if (query.isError || !query.data) {
    return (
      <Alert intent="warning" title="Could not load this trace">
        The lens service is unavailable. Try again shortly.
      </Alert>
    );
  }

  const root = query.data;
  const spans = flatten(root);
  const resolvedId = activeId ?? root.spanId;
  const selected = spans.find((s) => s.spanId === resolvedId) ?? root;

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Card>
        <Card.Body>
          <div data-testid="span-tree" className="max-h-[70vh] space-y-0.5 overflow-auto">
            <SpanNode
              node={root}
              depth={0}
              selectedId={resolvedId}
              collapsed={collapsed}
              onSelect={setSelectedId}
              onToggle={toggle}
              selectedRef={selectedRef}
            />
          </div>
        </Card.Body>
      </Card>
      <Card>
        <Card.Body>
          <SpanDetail span={selected} />
        </Card.Body>
      </Card>
    </div>
  );
}
