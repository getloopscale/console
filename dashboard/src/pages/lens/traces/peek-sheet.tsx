import { lazy, Suspense } from 'react';
import { Skeleton } from '@getloopscale/ui';

import { AppModal } from '@/components/ui/app-modal';
import { shortId } from '@/lib/formatting/format';
import { MetadataCard } from './metadata-card';

/**
 * M98 (D-H1) — the trace detail (a two-panel explorer that pulls in CodeMirror + react-markdown via
 * `io-cards`) is `lazy()`-loaded so its heavy chunk is OFF the `LensTracesPage` first-paint bundle and
 * only fetched when a row is peeked. The modal already animates in, masking the one-time load behind a
 * matching Skeleton (D-H2 risk-2 mitigation).
 */
/**
 * NAO troque este `lazy` por um import estatico "para fechar o ciclo do madge".
 *
 * B-001 — o `madge --circular` reporta uma aresta daqui para `trace-detail/index`,
 * fechando `index -> span-detail -> playground -> peek-sheet -> index`. Ela e
 * REAL no grafo e INOFENSIVA em runtime: esta linha e uma fronteira de
 * code-splitting, e o modulo so e avaliado quando o usuario abre um peek — muito
 * depois de todo o resto ter inicializado. Nao ha TDZ aqui, e o app foi
 * verificado montando (vite preview + Chrome headless).
 *
 * O madge nao distingue import dinamico de estatico, entao o ciclo aparece no
 * relatorio como se fosse divida. Converter para estatico teria DOIS custos e
 * nenhum ganho: reintroduziria o risco de ordem de init que os outros sete
 * ciclos tinham, e puxaria o trace-detail para o bundle eager, desfazendo parte
 * dos 180 kB brotli que B-021/B-073 tiraram do primeiro paint.
 */
const LensTraceDetail = lazy(() =>
  import('../trace-detail/index').then((m) => ({ default: m.LensTraceDetail })),
);

/**
 * The row-click **peek**: a wide modal hosting the full trace detail (the reader-mode span
 * explorer) and the tags/annotations panel. Open ⇔ `traceId !== null`; closing (backdrop / Esc /
 * the panel's own close) clears the open id. Presentation-only: the detail and the metadata own
 * their reads.
 */
export function TracePeekSheet({ traceId, onClose }: { traceId: string | null; onClose: () => void }) {
  return (
    <AppModal
      open={traceId !== null}
      onClose={onClose}
      title="Trace detail"
      description={<span className="font-mono text-xs">{traceId ? shortId(traceId, 16) : ''}</span>}
      size="xl"
      // The trace detail is a two-panel explorer (tree | detail + timeline): it needs real width.
      contentClassName="h-[85vh] w-[min(92vw,1400px)] max-w-none"
    >
      <div className="space-y-6">
        {traceId !== null ? (
          <Suspense fallback={<Skeleton className="h-64 w-full" data-testid="trace-detail-loading" />}>
            <LensTraceDetail key={traceId} traceId={traceId} />
          </Suspense>
        ) : null}
        {traceId !== null ? <MetadataCard traceId={traceId} onClose={onClose} /> : null}
      </div>
    </AppModal>
  );
}
