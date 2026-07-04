/**
 * csv.ts — shared CSV primitives (extracted from audit-csv.ts, theo-cloud#157).
 *
 * ONE source of the CSV formula-injection guard + RFC-4180 escaper, reused by every exporter (audit
 * log, traces) so the guard can never drift between them (DRY / Rule 9). No peer LLM-observability
 * dashboard neutralizes formula injection — this guard is deliberately kept over a CSV library.
 */

/** CSV formula-injection guard (CWE-1236 / OWASP "CSV Injection"). A value starting with `=`/`+`/`-`/
 *  `@`/tab/CR is a LIVE FORMULA in Excel / Google Sheets / LibreOffice (HYPERLINK/WEBSERVICE
 *  exfiltration, DDE command exec). Prefix a single apostrophe: the app treats it as a text marker
 *  (not displayed) and the value is inert. Applied BEFORE RFC escaping so the guard char is inside any
 *  quoting. */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** RFC 4180 field escaping: quote when the value contains a comma, quote, or CR/LF; double any
 *  embedded quote. */
export function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Build an RFC-4180 CSV: header + rows, CRLF-separated, each cell formula-guarded THEN escaped. */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const body = rows.map((r) => r.map((f) => csvField(neutralizeFormula(String(f)))).join(','));
  return [header.join(','), ...body].join('\r\n');
}
