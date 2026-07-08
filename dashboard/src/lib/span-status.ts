/**
 * Canonical span-error predicate — the single source of truth for "is this span an error?".
 *
 * A span's `statusCode` signals an error ONLY when it is one of the sanctioned OTLP error
 * tokens. Everything else — UNSET (`"0"`), OK (`"1"` / `STATUS_CODE_OK`), an unknown value,
 * or absent — is NOT an error (fail-safe).
 *
 * This replaces the divergent `statusCode !== "0"` predicate that painted OK spans red
 * (issue usetheodev/theo-cloud#176). Import this everywhere a span status is interpreted so
 * the trace-detail tree, waterfall, transcript, and compare views stay consistent.
 */

/** The only statusCode values that mean "error" — OTLP numeric `2` + the recomputed literals. */
export const ERROR_STATUS: ReadonlySet<string> = new Set(['2', 'ERROR', 'STATUS_CODE_ERROR']);

/** True iff a span's statusCode signals an error. Undefined/OK/unknown → false (fail-safe). */
export function isSpanError(statusCode: string | undefined): boolean {
  return statusCode != null && ERROR_STATUS.has(statusCode);
}
