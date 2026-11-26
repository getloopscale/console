import { useState } from 'react';
import { Button } from '@getloopscale/ui';

/**
 * Shared table-cell primitives for the Memory surfaces (UX pass 2026-07-22).
 * Split from memories.tsx per the 300-line module budget; consumed by the
 * Memories and Entities tables.
 */

/** Shared empty-cell fallback. */
export function EmDash() {
  return <span className="text-muted-foreground text-xs">—</span>;
}

/**
 * Clamp long text to N lines with an inline expand/collapse toggle — imported
 * memories reach 10K+ chars; unclamped rows made the tables unusable. Short
 * texts render without the toggle.
 */
export function ExpandableText({ text, lines = 3 }: { text: string; lines?: 2 | 3 }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 280;
  const clamp = lines === 2 ? 'line-clamp-2' : 'line-clamp-3';
  return (
    <div className="space-y-1 max-w-prose">
      <span className={`text-sm whitespace-pre-wrap break-words ${expanded ? '' : clamp}`}>
        {text}
      </span>
      {isLong ? (
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}

interface TablePagerProps {
  offset: number;
  pageSize: number;
  /** Rows on the CURRENT page (a short page disables Next). */
  pageCount: number;
  total?: number | undefined;
  busy?: boolean;
  onOffsetChange: (nextOffset: number) => void;
}

/**
 * Offset pager for the Memory tables (the pager was MISSING — with 25/page,
 * everything past the first page was unreachable from the UI). URL-state-driven
 * by the caller so pages stay deep-linkable.
 */
export function TablePager({ offset, pageSize, pageCount, total, busy, onOffsetChange }: TablePagerProps) {
  const rangeEnd = offset + pageCount;
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t">
      <span className="text-xs text-muted-foreground tabular-nums">
        {`${String(offset + 1)}–${String(rangeEnd)}${total !== undefined ? ` of ${String(total)}` : ''}`}
      </span>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={offset === 0 || busy === true}
          onClick={() => onOffsetChange(Math.max(0, offset - pageSize))}
        >
          ← Previous
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pageCount < pageSize || busy === true}
          onClick={() => onOffsetChange(offset + pageSize)}
        >
          Next →
        </Button>
      </div>
    </div>
  );
}
