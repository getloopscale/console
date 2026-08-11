/**
 * M98 (audit D-M6) — the shared shape of "a lens API error → a user-facing message". Every lens page
 * hand-rolled the same boilerplate: pull the HTTP `status` off the error, `switch` on it, fall back to
 * a page-specific default. This centralises the extraction + lookup; each page passes only its own
 * per-status wording (so behavior is unchanged) instead of duplicating the switch.
 */
export function lensErrorMessage(
  err: unknown,
  messages: Partial<Record<number, string>>,
  fallback: string,
): string {
  const status = (err as { status?: number } | null)?.status ?? 0;
  return messages[status] ?? fallback;
}
