/**
 * How the Status screen writes metric values. The API sends floats as computed (p95 in seconds,
 * request rates over 5 minutes), so 0.095 s × 1000 reached the screen as "94.99999999999999ms"
 * and a 0.2 req/s rate needs decimals to read as anything but zero (#553). Shared by the KPI strip
 * and the signal grid so the two never disagree.
 */

/** Whole milliseconds. `null` for anything that is not a finite number. */
export function formatLatencyMs(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return `${Math.round(v)}ms`;
}

/** Two decimals below 10 requests per second, whole numbers from 10 up. */
export function formatRps(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.abs(v) < 10 ? v.toFixed(2) : String(Math.round(v));
}
