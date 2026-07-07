import { Sheet } from '@usetheo/ui';

import { shortId } from '@/lib/format';
import { LensTraceDetail } from '../trace-detail';
import { MetadataCard } from './metadata-card';

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
      <Sheet.Content side="right" className="w-full overflow-auto sm:max-w-4xl">
        <Sheet.Header className="border-b border-border px-6 py-4">
          <Sheet.Title>Trace detail</Sheet.Title>
          <Sheet.Description className="font-mono text-xs">{traceId ? shortId(traceId, 16) : ''}</Sheet.Description>
        </Sheet.Header>
        <Sheet.Body className="space-y-6 px-6 py-5">
          {traceId !== null ? <LensTraceDetail key={traceId} traceId={traceId} /> : null}
          {traceId !== null ? <MetadataCard traceId={traceId} onClose={onClose} /> : null}
        </Sheet.Body>
      </Sheet.Content>
    </Sheet>
  );
}
