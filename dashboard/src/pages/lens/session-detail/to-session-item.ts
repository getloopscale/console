import type { SessionTraceItem } from '@usetheo/ui';
import { isSpanError } from '@/pages/lens/span-status';
import type { Trace } from '../traces/columns';

/**
 * M9 adoption — the boundary mapper from the theo-lens traces-list row (`Trace`: OTLP-shaped
 * `traceId` + `startTimeUnixNano` string ns + `durationMs`) to the `@usetheo/ui` generic
 * `SessionTraceItem` (`id` + `startTime` + `endTime` + collapsed OK/ERROR `status`). The lib's
 * session components (`SessionSummary`, `SessionTimeline`) consume `SessionTraceItem`; this is the
 * single place the two shapes meet — mirroring the M8 `to-trace-span.ts` precedent.
 *
 * Pure + total: never throws, never does I/O.
 *   - `endTime` is computed in ns as `start + round(durationMs * 1e6)`. When the start is absent or
 *     non-numeric, or the duration is absent, the end is honestly `null` (the component renders it as
 *     in-flight / unbounded) — never a fabricated end.
 *   - `status` collapses the OTLP status vocabulary (numeric `2` / `STATUS_CODE_ERROR`, plus the
 *     lowercase `"error"` string form the list renderer honors) to the lib's `"OK" | "ERROR"`; a trace
 *     with no status at all stays `undefined` (honest absence, never a fabricated `"OK"`).
 */
export function toSessionItem(trace: Trace): SessionTraceItem {
  return {
    id: trace.traceId,
    name: trace.name,
    startTime: trace.startTimeUnixNano,
    endTime: computeEndNs(trace.startTimeUnixNano, trace.durationMs),
    status: mapStatus(trace),
    model: trace.model,
    costUsd: trace.costUsd,
    totalTokens: trace.totalTokens,
  };
}

/**
 * Effective end of a trace in unix-ns: `start + round(durationMs * 1e6)`, using BigInt so the 19-digit
 * ns value never loses precision. Returns `null` (in-flight / unknown) when the start is missing or
 * non-numeric, or the duration is missing — never throws on a garbage start.
 */
function computeEndNs(startNs: string | undefined, durationMs: number | undefined): bigint | null {
  if (startNs == null || durationMs == null || !Number.isFinite(durationMs)) return null;
  try {
    return BigInt(startNs) + BigInt(Math.round(durationMs * 1e6));
  } catch {
    return null;
  }
}

/**
 * Collapse the trace's status to the lib's `"OK" | "ERROR"`, or `undefined` when the trace carries no
 * status token at all. Reuses the canonical `isSpanError` predicate (the OTLP `2` / `ERROR` /
 * `STATUS_CODE_ERROR` set) PLUS the lowercase `"error"` string form — the exact pair the traces-list
 * column renderer uses (`src/pages/lens/traces/columns.tsx`), so the detail page agrees with the list.
 */
function mapStatus(trace: Trace): 'OK' | 'ERROR' | undefined {
  const s = trace.statusCode ?? trace.status;
  if (!s) return undefined;
  return isSpanError(s) || s.toLowerCase() === 'error' ? 'ERROR' : 'OK';
}
