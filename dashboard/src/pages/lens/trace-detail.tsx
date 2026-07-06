/**
 * M58 D1 re-export shim.
 *
 * `src/pages/lens/trace-detail.tsx` was a 680-LoC view that already breached the 500-LoC
 * `architecture.md` budget. M58 Phase 0 split it into the `trace-detail/` module dir:
 *   - `trace-detail/helpers.ts`   — pure, total layout/parse helpers + `TraceSpanNode`
 *   - `trace-detail/breadcrumb.tsx` — URL selection store + breadcrumb + keyboard next/prev
 *   - `trace-detail/index.tsx`     — the composition root (fetch + layout + URL-driven selection)
 *
 * This file re-exports the moved public surface so every existing import keeps resolving with zero
 * churn: `trace-detail.test.tsx`, `compare.tsx`, `compare-core.ts`, and `playground.tsx` import
 * `TraceSpanNode`, `durationMs`, `prettyValue`, `asChat`, `computeTraceBounds`, `computeBarLayout`,
 * `flattenVisible`, `VIRTUALIZE_THRESHOLD`, and `LensTraceDetail` from `./trace-detail`.
 */

export {
  durationMs,
  prettyValue,
  asChat,
  computeTraceBounds,
  computeBarLayout,
  flattenVisible,
  flattenAll,
  VIRTUALIZE_THRESHOLD,
  type TraceSpanNode,
  type ChatMessage,
  type FlatNode,
} from './trace-detail/helpers';

export { LensTraceDetail } from './trace-detail/index';
