/**
 * audit-csv.ts — J-14 CSV export.
 *
 * Exports the current audit `AuditEntry[]` view as an RFC 4180 CSV file via
 * the canonical Blob + anchor.click pattern (mirrors log-download.ts).
 *
 * Columns carry RAW fields (each its own column: action, resource_type,
 * resource_id, …) rather than the humanized `displayAction` string the table
 * renders — a CSV is for spreadsheet analysis (pivot/filter), where separate
 * machine-faithful columns beat a pretty prose string.
 *
 * EC — SAFARI/FIREFOX REVOKE TIMING (per log-download.ts EC-4): revoking the
 * object URL immediately after `click()` can abort the download before Safari
 * finishes streaming. Defer revoke via setTimeout so the browser can read it.
 */

import type { AuditEntry } from './api/types';

const HEADER = [
  'Timestamp',
  'Actor',
  'Action',
  'Resource Type',
  'Resource ID',
  'Severity',
  'Correlation ID',
] as const;

/** CSV formula-injection guard (CWE-1236 / OWASP "CSV Injection", theo-cloud#157).
 *  Audit fields are user-authored (project names, emails, resource ids) and the
 *  export is opened by a privileged owner — a value starting with =/+/-/@/tab/CR
 *  is a LIVE FORMULA in Excel / Google Sheets / LibreOffice (HYPERLINK/WEBSERVICE
 *  exfiltration, DDE command exec). Prefix a single apostrophe: Excel treats it
 *  as a text marker (not displayed) and the value is inert. Applied BEFORE RFC
 *  escaping so the guard char is inside any quoting. */
function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** RFC 4180 field escaping: quote when the value contains a comma, quote, or
 *  CR/LF; double any embedded quote. */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function auditEntriesToCsv(entries: AuditEntry[]): string {
  const rows = entries.map((e) =>
    [
      e.timestamp || e.ts || '',
      e.actor || e.actor_email || '',
      e.action || '',
      e.resource_type ?? '',
      e.resource_id ?? '',
      e.severity ?? '',
      e.correlation_id ?? '',
    ]
      .map((f) => csvField(neutralizeFormula(String(f))))
      .join(','),
  );
  return [HEADER.join(','), ...rows].join('\r\n');
}

export function triggerAuditCsvDownload(entries: AuditEntry[]): void {
  if (typeof document === 'undefined') return;
  const csv = auditEntriesToCsv(entries);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString()}.csv`;
  document.body.appendChild(a);
  a.click();
  // Defer revoke so Safari + Firefox can finish streaming the download.
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}
