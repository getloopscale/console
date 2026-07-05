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
import { toCsv } from './csv';
import { triggerDownload } from './download';

const HEADER = [
  'Timestamp',
  'Actor',
  'Action',
  'Resource Type',
  'Resource ID',
  'Severity',
  'Correlation ID',
] as const;

export function auditEntriesToCsv(entries: AuditEntry[]): string {
  // The CWE-1236 formula-injection guard + RFC-4180 escaping now live in lib/csv.ts (one source,
  // reused by audit + traces export — Rule 9). Behavior is unchanged.
  const rows = entries.map((e) => [
    e.timestamp || e.ts || '',
    e.actor || e.actor_email || '',
    e.action || '',
    e.resource_type ?? '',
    e.resource_id ?? '',
    e.severity ?? '',
    e.correlation_id ?? '',
  ].map((f) => String(f)));
  return toCsv(HEADER, rows);
}

export function triggerAuditCsvDownload(entries: AuditEntry[]): void {
  triggerDownload(`audit-log-${new Date().toISOString()}.csv`, auditEntriesToCsv(entries), 'text/csv;charset=utf-8');
}
