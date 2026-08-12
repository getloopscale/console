/**
 * log-download.ts — J-19 T2.3 (R7 blueprint SHOULD).
 *
 * Exports the current `LogLine[]` buffer as a plain-text `.log` file via
 * the canonical Blob + anchor.click pattern.
 *
 * **EC-4 SAFARI/FIREFOX REVOKE TIMING** (per impl edge cases review):
 * `URL.revokeObjectURL` IMMEDIATELY after `anchor.click()` invalidates
 * the `blob:` URL before Safari (and some older Chrome / Firefox) can
 * stream the download. The MDN-canonical fix is to defer revoke via
 * `setTimeout(..., 1000)` — gives the browser time to start reading.
 *
 * Decision Q3 (plan Unresolved Questions, v1.1 default): the download
 * exports the FULL buffer, not the filter-mismatch subset. Matches Vercel
 * V1 terminal-redirect behavior. Revisit per sponsor walkthrough feedback.
 */

import type { LogLine } from '@/lib/api/types';
import { triggerDownload } from '@/lib/export/download';

export function formatLineForExport(line: LogLine): string {
  const src = line.source ? `${line.source} ` : '';
  return `${line.ts} ${line.level.toUpperCase()} ${src}${line.msg}`;
}

export function triggerLogDownload(lines: LogLine[]): void {
  // B-230 — era a SEGUNDA cópia do padrão Blob+âncora, com o docblock do EC-4 duplicado junto.
  // A duplicação do comentário é o sinal: quem copiou sabia que havia uma sutileza e a levou
  // consigo, em vez de reusar quem já a conhecia.
  triggerDownload(
    `runtime-logs-${new Date().toISOString()}.log`,
    lines.map(formatLineForExport).join('\n'),
    'text/plain',
  );
}
