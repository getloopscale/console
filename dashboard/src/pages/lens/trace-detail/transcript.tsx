import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge, Button, Card, EmptyState, StatusDot } from '@usetheo/ui';

import { formatCost, formatDuration, formatTokens } from '@/lib/format';
import { VIRTUALIZE_THRESHOLD } from './helpers';
import {
  toTranscriptRows,
  type TranscriptRow,
  type TranscriptRowStats,
  type TraceSpanNode,
} from '@/lib/trace-layout';

/**
 * M58 P4.2 — the reader-mode Transcript (the flagship differentiator; ADR D2, blueprint §4). A
 * legible feed of the span tree flattened by the pure `toTranscriptRows` (T4.1): each `span` row is a
 * bordered Card (role Badge + error StatusDot + inline output preview + micro-stats), and a subagent
 * subtree (≥2 children) gets a collapsible `group-header` row. A single default-span trace shows an
 * EmptyState nudging back to the Tree.
 *
 * Scale strategy MIRRORS `./tree` (VirtualTree): below `VIRTUALIZE_THRESHOLD` the whole feed renders
 * as a plain list (our Claude Code agent traces are small — a handful of spans), and only at/above the
 * threshold does it switch to `@tanstack/react-virtual` (already installed + used by VirtualTree —
 * REUSED, never re-implemented; parsimony rung 4). Every row is reachable in both paths: the plain
 * list renders all of them, and virtualization windows without dropping. No silent slice-and-drop.
 *
 * Selection syncs through the URL store (Phase 0): clicking a row calls `onSelect(spanId)` which the
 * composition root writes to `?spanId=`. This is presentation-only — no I/O, no direct URL access.
 */

/** Which subtrees are collapsed (keyed by the group's `spanId`) → the set of hidden descendant spanIds. */
function hiddenSpanIds(root: TraceSpanNode, collapsedGroups: Set<string>): Set<string> {
  const hidden = new Set<string>();
  const collect = (node: TraceSpanNode) => {
    for (const c of node.children ?? []) {
      hidden.add(c.spanId);
      collect(c);
    }
  };
  const walk = (node: TraceSpanNode) => {
    if (collapsedGroups.has(node.spanId)) collect(node); // hide the whole subtree below a collapsed group
    for (const c of node.children ?? []) walk(c);
  };
  walk(root);
  return hidden;
}

/** Compact micro-stats line: tokens in→out · cost · duration. Omits pieces the span does not carry. */
function StatsLine({ stats }: { stats?: TranscriptRowStats }) {
  if (!stats) return null;
  const parts: string[] = [];
  if (stats.inputTokens > 0 || stats.outputTokens > 0) {
    parts.push(`${formatTokens(stats.inputTokens)}→${formatTokens(stats.outputTokens)}`);
  }
  if (stats.costUsd > 0) parts.push(formatCost(stats.costUsd));
  if (stats.durationMs !== null) parts.push(formatDuration(stats.durationMs));
  if (parts.length === 0) return null;
  return <span className="shrink-0 text-[10px] text-muted-foreground">{parts.join(' · ')}</span>;
}

/** One reader-mode span Card: role Badge + span name + error StatusDot + inline output preview + micro-stats. */
function SpanRowCard({
  row,
  name,
  isError,
  selected,
  onSelect,
}: {
  row: TranscriptRow;
  name: string;
  isError: boolean;
  selected: boolean;
  onSelect: (spanId: string) => void;
}) {
  return (
    <Card size="sm" data-testid="transcript-row" className={selected ? 'ring-1 ring-primary' : undefined}>
      <Card.Body className="py-2">
        <button
          type="button"
          aria-current={selected ? 'true' : undefined}
          onClick={() => onSelect(row.spanId)}
          className="flex w-full items-center gap-2 text-left"
        >
          {isError ? <StatusDot status="failed" size="xs" /> : <StatusDot status="live" size="xs" />}
          <Badge variant="outline" className="shrink-0">
            {row.role}
          </Badge>
          {/* The span name identifies WHICH span this row is (selection target + reader legibility). */}
          <span className="shrink-0 font-mono text-xs font-medium">{name}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {row.preview ? row.preview : <span className="italic">no output</span>}
          </span>
          <StatsLine stats={row.stats} />
        </button>
      </Card.Body>
    </Card>
  );
}

/** A collapsible subagent-group header row. Toggles its subtree's visibility in the feed. */
function GroupHeaderRow({
  row,
  name,
  open,
  onToggle,
}: {
  row: TranscriptRow;
  name: string;
  open: boolean;
  onToggle: (groupId: string) => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-expanded={open}
      aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
      onClick={() => onToggle(row.groupId ?? row.spanId)}
      data-testid="transcript-group-header"
      className="w-full justify-start gap-1.5"
    >
      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      <span className="font-mono text-xs font-semibold">{`${name} (subagent)`}</span>
    </Button>
  );
}

/** Render one feed row (group-header or span Card) — shared by the plain and virtualized paths. */
function FeedRow({
  row,
  node,
  selectedId,
  collapsedGroups,
  onSelect,
  onToggle,
}: {
  row: TranscriptRow;
  node?: TraceSpanNode;
  selectedId: string;
  collapsedGroups: Set<string>;
  onSelect: (spanId: string) => void;
  onToggle: (groupId: string) => void;
}) {
  if (row.kind === 'group-header') {
    return (
      <GroupHeaderRow
        row={row}
        name={node?.name ?? row.spanId}
        open={!collapsedGroups.has(row.groupId ?? row.spanId)}
        onToggle={onToggle}
      />
    );
  }
  const isError = !!node?.statusCode && node.statusCode !== '0';
  return (
    <SpanRowCard
      row={row}
      name={node?.name ?? row.spanId}
      isError={isError}
      selected={row.spanId === selectedId}
      onSelect={onSelect}
    />
  );
}

/** Virtualized feed (large traces — at/above the threshold), reusing @tanstack/react-virtual. */
function VirtualFeed({
  rows,
  byId,
  selectedId,
  collapsedGroups,
  onSelect,
  onToggle,
}: {
  rows: TranscriptRow[];
  byId: Map<string, TraceSpanNode>;
  selectedId: string;
  collapsedGroups: Set<string>;
  onSelect: (spanId: string) => void;
  onToggle: (groupId: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 12,
    initialRect: { width: 480, height: 640 },
  });
  return (
    <div ref={parentRef} data-testid="transcript-feed" className="max-h-[70vh] overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index];
          return (
            <div
              key={`${vi.index}-${row.kind}-${row.spanId}`}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              className="pb-1.5"
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
            >
              <FeedRow
                row={row}
                node={byId.get(row.spanId)}
                selectedId={selectedId}
                collapsedGroups={collapsedGroups}
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

export function Transcript({
  root,
  selectedId,
  onSelect,
}: {
  root: TraceSpanNode;
  selectedId: string;
  onSelect: (spanId: string) => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  const allRows = useMemo(() => toTranscriptRows(root), [root]);
  // Look up a span's error state + display name by spanId (the row model carries neither directly).
  const byId = useMemo(() => {
    const map = new Map<string, TraceSpanNode>();
    const walk = (n: TraceSpanNode) => {
      map.set(n.spanId, n);
      for (const c of n.children ?? []) walk(c);
    };
    walk(root);
    return map;
  }, [root]);

  const hidden = useMemo(() => hiddenSpanIds(root, collapsedGroups), [root, collapsedGroups]);
  // The visible feed: drop any row whose span sits inside a collapsed subtree. Group-header rows are
  // kept (they are the toggle) unless the group itself is inside another collapsed subtree.
  const rows = useMemo(() => allRows.filter((r) => !hidden.has(r.spanId)), [allRows, hidden]);

  const toggleGroup = (groupId: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });

  // A default-span-only trace (exactly one span row, no groups) has nothing to read as a feed.
  const isSingleSpan = allRows.length === 1 && allRows[0].kind === 'span';
  if (isSingleSpan) {
    return (
      <EmptyState
        title="Only one span in this trace"
        description="There is no subagent history to read — switch to Tree view to inspect the span."
        dashed
      />
    );
  }

  // Mirror VirtualTree: small traces render every row as a plain list (the common Claude Code path);
  // large traces window through react-virtual. Both keep every row reachable — no silent drop.
  if (rows.length >= VIRTUALIZE_THRESHOLD) {
    return (
      <VirtualFeed
        rows={rows}
        byId={byId}
        selectedId={selectedId}
        collapsedGroups={collapsedGroups}
        onSelect={onSelect}
        onToggle={toggleGroup}
      />
    );
  }

  return (
    <div data-testid="transcript-feed" className="max-h-[70vh] space-y-1.5 overflow-auto">
      {rows.map((row) => (
        <FeedRow
          key={`${row.kind}-${row.spanId}`}
          row={row}
          node={byId.get(row.spanId)}
          selectedId={selectedId}
          collapsedGroups={collapsedGroups}
          onSelect={onSelect}
          onToggle={toggleGroup}
        />
      ))}
    </div>
  );
}
