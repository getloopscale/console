/**
 * M58 D1 re-export shim.
 *
 * `src/pages/lens/trace-detail.tsx` was a 680-LoC view that already breached the 500-LoC
 * budget. M58 Phase 0 split it into the `trace-detail/` module dir:
 *   - `trace-detail/helpers.ts`   — pure, total layout/parse helpers + `TraceSpanNode`
 *   - `trace-detail/breadcrumb.tsx` — URL selection store + breadcrumb + keyboard next/prev
 *   - `trace-detail/index.tsx`     — the composition root (fetch + layout + URL-driven selection)
 *
 * @deprecated Camada de migracao, nao superficie publica. Os consumidores que precisam apenas
 * dos helpers puros ja importam `./trace-detail/helpers` direto — foi o que quebrou os ciclos
 * da familia lens (B-001). Restam aqui os consumidores de `LensTraceDetail` e os que ainda
 * apontam para este caminho. Quando `trace-detail.test.tsx`, `compare.tsx` e `peek-sheet.tsx`
 * forem migrados para `./trace-detail/helpers` e `./trace-detail/index`, este arquivo deve ser
 * APAGADO — nao mantido "por seguranca". Sunset: 2026-11-06 (B-079).
 *
 * O docblock anterior listava `VIRTUALIZE_THRESHOLD`, `ChatMessage` e `FlatNode` entre os
 * simbolos re-exportados "para que os imports existentes resolvam". Os tres tinham ZERO
 * consumidores fora deste arquivo (verificado: unica ocorrencia era a propria linha de
 * re-export), entao sairam. Descrever uma superficie mais larga do que a real e o que faz um
 * shim de migracao sobreviver a propria razao de existir.
 */

export {
  durationMs,
  prettyValue,
  asChat,
  computeTraceBounds,
  computeBarLayout,
  flattenVisible,
  flattenAll,
  type TraceSpanNode,
} from './trace-detail/helpers';

export { LensTraceDetail } from './trace-detail/index';
