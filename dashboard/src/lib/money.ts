/**
 * money.ts — J-13 (MEET-2026-07-03-004).
 *
 * Money crosses the wire as integer minor units + an explicit currency (never
 * a float). The ONLY division by 100 happens here, at display time; callers
 * pass the raw `amount_minor` straight from the API.
 */
export function formatMinor(amountMinor: number, currency: string): string {
  const cur = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: cur,
    }).format(amountMinor / 100);
  } catch {
    // Unknown/invalid currency code — never throw in a table cell.
    return `${cur} ${(amountMinor / 100).toFixed(2)}`;
  }
}
