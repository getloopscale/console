/**
 * download.ts — shared client-side file download (extracted from audit-csv.ts / log-download.ts).
 *
 * The canonical Blob + anchor.click pattern, ONE source reused by every exporter (audit, logs,
 * traces — DRY / Rule 9). EC — SAFARI/FIREFOX REVOKE TIMING: revoking the object URL immediately
 * after `click()` can abort the download before Safari finishes streaming; defer revoke via setTimeout.
 */

/** Trigger a browser download of `content` as `filename` with the given MIME type. No-op outside a DOM. */
export function triggerDownload(filename: string, content: string, mimeType: string): void {
  triggerBlobDownload(filename, new Blob([content], { type: mimeType }));
}

/**
 * O mesmo download, para bytes que já são um `Blob` (B-230).
 *
 * Existia uma terceira cópia deste padrão em `pages/workspace/overview.tsx`, para um download
 * binário vindo de uma URL pré-assinada — e ela tinha perdido as DUAS proteções que o docblock
 * acima explica: sem `appendChild`, e revogando a URL do objeto imediatamente após o `click()`,
 * que aborta o download antes de o Safari terminar de transmitir.
 *
 * A cópia existia porque `triggerDownload` só aceitava `string`. O helper que se declarava a ÚNICA
 * fonte não servia o caso binário, então o caso binário se serviu sozinho — e perdeu o que a fonte
 * única sabia. Widening the signature is what makes the claim true.
 */
export function triggerBlobDownload(filename: string, blob: Blob): void {
  if (typeof document === 'undefined') return;
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
