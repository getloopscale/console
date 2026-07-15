import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Breadcrumb as UiBreadcrumb } from '@usetheo/ui';

import type { TraceSpanNode } from './helpers';

/**
 * M58 Phase 0 — the URL is the single source of truth for selection + view (ADR D3).
 *
 * `useSelection()` reads `spanId`/`tab`/`view` from the router query (via react-router's
 * `useSearchParams`, the mechanism the rest of the dashboard already uses — e.g. `domains.tsx`,
 * `project-status.tsx`) and exposes `setSelection(partial)` which merges a partial into the query
 * string (replace-history, so span stepping does not flood the back-stack). `traceId` is supplied by
 * the caller (the detail is mounted with a `traceId` prop by `traces.tsx`), not read from the route.
 */

export interface Selection {
  traceId: string;
  spanId: string | null;
  tab: string | null;
  view: string | null;
  setSelection: (partial: { spanId?: string | null; tab?: string | null; view?: string | null }) => void;
}

export function useSelection(traceId: string): Selection {
  const [searchParams, setSearchParams] = useSearchParams();
  const spanId = searchParams.get('spanId');
  const tab = searchParams.get('tab');
  const view = searchParams.get('view');

  const setSelection = useCallback(
    (partial: { spanId?: string | null; tab?: string | null; view?: string | null }) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const key of ['spanId', 'tab', 'view'] as const) {
            if (!(key in partial)) continue;
            const value = partial[key];
            if (value === null || value === undefined || value === '') next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { traceId, spanId, tab, view, setSelection };
}

/**
 * Pure: the ancestor chain root..selected (inclusive), or `[]` when `spanId` is not in the tree.
 * Depth-first search carrying the path so a stale deep-link (unknown span) yields `[]` — the caller
 * then falls back to the root. Total: never throws.
 */
export function ancestors(root: TraceSpanNode, spanId: string): TraceSpanNode[] {
  const walk = (node: TraceSpanNode, path: TraceSpanNode[]): TraceSpanNode[] | null => {
    const here = [...path, node];
    if (node.spanId === spanId) return here;
    for (const child of node.children ?? []) {
      const found = walk(child, here);
      if (found) return found;
    }
    return null;
  };
  return walk(root, []) ?? [];
}

/**
 * Breadcrumb of the selected span's ancestor chain over the `@usetheo/ui`
 * Breadcrumb primitive (M7 adoption T2.3 — the primitive shipped in 0.16.0,
 * superseding the hand-rolled Button trail). Clicking a crumb sets `spanId`
 * via the URL store (crumbs are buttons through `Link asChild`); the selected
 * span renders as `Breadcrumb.Page` (aria-current="page"). testids preservados
 * para a suíte do trace-detail.
 */
export function Breadcrumb({
  root,
  selectedId,
  onSelect,
}: {
  root: TraceSpanNode;
  selectedId: string;
  onSelect: (spanId: string) => void;
}) {
  const chain = useMemo(() => {
    const found = ancestors(root, selectedId);
    return found.length > 0 ? found : [root]; // stale/unknown span → show the root crumb
  }, [root, selectedId]);

  return (
    <UiBreadcrumb
      aria-label="Selected span breadcrumb"
      data-testid="trace-breadcrumb"
      className="text-xs"
    >
      <UiBreadcrumb.List>
        {chain.map((node, i) => (
          <UiBreadcrumb.Item key={`${i}-${node.spanId}`}>
            {i > 0 ? <UiBreadcrumb.Separator /> : null}
            {node.spanId === selectedId ? (
              <UiBreadcrumb.Page data-testid="breadcrumb-crumb" className="font-medium font-mono text-foreground">
                {node.name}
              </UiBreadcrumb.Page>
            ) : (
              <UiBreadcrumb.Link asChild>
                <button
                  type="button"
                  data-testid="breadcrumb-crumb"
                  onClick={() => onSelect(node.spanId)}
                  className="rounded px-1 py-0.5 font-mono text-muted-foreground text-xs hover:text-foreground"
                >
                  {node.name}
                </button>
              </UiBreadcrumb.Link>
            )}
          </UiBreadcrumb.Item>
        ))}
      </UiBreadcrumb.List>
    </UiBreadcrumb>
  );
}

/**
 * Bind `]`/`[` to next/prev span in the given visible order, writing the new `spanId` to the URL.
 * NO wrap: `[` at the first span and `]` at the last span are no-ops. Ignores key events originating
 * from a text input/textarea/contenteditable so typing in a field never steals the shortcut.
 */
export function useSpanKeyboardNav(
  visibleIds: string[],
  selectedId: string,
  onSelect: (spanId: string) => void,
): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== ']' && e.key !== '[') return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      const index = visibleIds.indexOf(selectedId);
      if (index < 0) return;
      const nextIndex = e.key === ']' ? index + 1 : index - 1;
      if (nextIndex < 0 || nextIndex >= visibleIds.length) return; // no wrap at the ends
      e.preventDefault();
      onSelect(visibleIds[nextIndex]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visibleIds, selectedId, onSelect]);
}
