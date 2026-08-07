/**
 * download.ts — shared client-side file download (extracted from audit-csv.ts / log-download.ts).
 *
 * The canonical Blob + anchor.click pattern, ONE source reused by every exporter (audit, logs,
 * traces — DRY / Rule 9). EC — SAFARI/FIREFOX REVOKE TIMING: revoking the object URL immediately
 * after `click()` can abort the download before Safari finishes streaming; defer revoke via setTimeout.
 */

/** Trigger a browser download of `content` as `filename` with the given MIME type. No-op outside a DOM. */
export function triggerDownload(filename: string, content: string, mimeType: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Defer revoke so Safari + Firefox can finish streaming the download.
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}
