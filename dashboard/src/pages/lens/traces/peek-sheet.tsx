import { lazy, Suspense } from 'react';
import { Sheet, Skeleton } from '@usetheo/ui';

import { shortId } from '@/lib/format';
import { MetadataCard } from './metadata-card';

/**
 * M98 (D-H1) — the trace detail (a two-panel explorer that pulls in CodeMirror + react-markdown via
 * `io-cards`) is `lazy()`-loaded so its heavy chunk is OFF the `LensTracesPage` first-paint bundle and
 * only fetched when a row is peeked. The Sheet already animates in, masking the one-time load behind a
 * matching Skeleton (D-H2 risk-2 mitigation).
 */
const LensTraceDetail = lazy(() =>
  import('../trace-detail').then((m) => ({ default: m.LensTraceDetail })),
);

/**
 * M59 P1 T1.2 — the row-click **peek**: a right-side `Sheet` hosting the full trace detail (the M58
 * reader-mode span explorer) + the M44 tags/annotations panel, instead of the old inline card that
 * pushed the table down. Blueprint §3 ("row-click → Sheet peek for fast triage — a side panel, not a
 * full route"). Open ⇔ `traceId !== null`; closing (backdrop / Esc / the panel's own close) clears the
 * open id. Presentation-only — no fetch here (the detail + metadata own their reads).
 */
export function TracePeekSheet({ traceId, onClose }: { traceId: string | null; onClose: () => void }) {
  return (
    <Sheet
      open={traceId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* The trace detail is a two-panel explorer (tree | detail + timeline) — it needs real width.
          @usetheo/ui's Sheet.Content defaults to a narrow `max-w-md` (448px) that a Tailwind class
          can't reliably override (tailwind-merge keeps its own arbitrary/standard width), so the width
          is set via inline style (highest specificity): a wide near-full-viewport overlay. */}
      <Sheet.Content
        side="right"
        className="w-full overflow-auto"
        style={{ width: '92vw', maxWidth: '1400px' }}
      >
        <Sheet.Header className="border-b border-border px-6 py-4">
          <Sheet.Title>Trace detail</Sheet.Title>
          <Sheet.Description className="font-mono text-xs">{traceId ? shortId(traceId, 16) : ''}</Sheet.Description>
        </Sheet.Header>
        <Sheet.Body className="space-y-6 px-6 py-5">
          {traceId !== null ? (
            <Suspense fallback={<Skeleton className="h-64 w-full" data-testid="trace-detail-loading" />}>
              <LensTraceDetail key={traceId} traceId={traceId} />
            </Suspense>
          ) : null}
          {traceId !== null ? <MetadataCard traceId={traceId} onClose={onClose} /> : null}
        </Sheet.Body>
      </Sheet.Content>
    </Sheet>
  );
}
