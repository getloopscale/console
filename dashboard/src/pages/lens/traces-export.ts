/**
 * traces-export.ts — M56 data export for the Observability traces list.
 *
 * Exports the currently-filtered trace set (WYSIWYG — reuses the list's `buildTraceQuery`) as CSV
 * (formula-injection-safe + RFC-4180, via lib/csv.ts) or JSON (raw machine-faithful records). Bounded
 * by a documented `EXPORT_CAP` with an honest "capped" disclosure — no silent truncation (a failure
 * mode every peer LLM-observability dashboard has). No new dependency; reuses the shipped CSV guard +
 * Blob download.
 */
import { toCsv } from '@/lib/csv';

/** The backend caps `limit` at LIST_TRACES_LIMIT_CAP=500 per request; we page by it. */
export const PAGE_SIZE = 500;
/** The documented maximum rows an export gathers (10 pages). Beyond this, the export discloses "capped". */
export const EXPORT_CAP = 5000;

/** One trace row as the read API returns it (`traceListItemSchema`) — the machine-faithful shape. */
export interface ExportTrace {
  traceId: string;
  name?: string;
  model?: string;
  status?: string;
  statusCode?: string;
  durationMs?: number;
  costUsd?: number;
  totalTokens?: number;
  sessionId?: string;
  startTimeUnixNano?: string;
}

const COLUMNS = [
  'traceId',
  'name',
  'model',
  'statusCode',
  'durationMs',
  'costUsd',
  'totalTokens',
  'sessionId',
  'startTimeUnixNano',
] as const;

const cell = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/** Machine-faithful, injection-safe CSV of the traces (columns from the read API's list item). */
export function tracesToCsv(traces: readonly ExportTrace[]): string {
  const rows = traces.map((t) => COLUMNS.map((c) => cell((t as unknown as Record<string, unknown>)[c])));
  return toCsv(COLUMNS, rows);
}

/** Raw records array (no reshape) — export == API, the least-surprise contract. */
export function tracesToJson(traces: readonly ExportTrace[]): string {
  return JSON.stringify(traces, null, 2);
}

/**
 * Gather the filtered set up to `cap`, paging by PAGE_SIZE. `baseQuery` is the list's `buildTraceQuery`
 * output (`?...` or ``). `fetchPage` fetches one page for a query with `limit`/`offset` appended
 * (injected so the core is unit-testable without the network). Returns the rows + whether the cap was
 * hit (`capped: true` → there may be more; the UI discloses it — never a silent truncation).
 */
export async function fetchFilteredTraces(
  baseQuery: string,
  fetchPage: (queryWithPaging: string) => Promise<ExportTrace[]>,
  cap: number = EXPORT_CAP,
): Promise<{ traces: ExportTrace[]; capped: boolean }> {
  const out: ExportTrace[] = [];
  let offset = 0;
  for (;;) {
    const sep = baseQuery.includes('?') ? '&' : '?';
    const page = await fetchPage(`${baseQuery}${sep}limit=${PAGE_SIZE}&offset=${offset}`);
    out.push(...page);
    if (out.length >= cap) return { traces: out.slice(0, cap), capped: true };
    if (page.length < PAGE_SIZE) return { traces: out, capped: false }; // partial page → complete set
    offset += PAGE_SIZE;
  }
}
