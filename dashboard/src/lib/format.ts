// Display formatters — single source of truth for dates + numbers across
// the dashboard. Eliminates the drift documented in plan v1.1 P-1 + P-2:
// before this module, pages used a mix of `new Date(iso).toLocaleDateString()`
// (browser-locale dependent — DD/MM/YYYY in PT-BR, MM/DD/YYYY in en-US),
// raw `iso` strings, and inline number rendering without separators.
//
// Decisions (ADR-D1 + ADR-D4 of plan v1.1):
//   - Locale: en-US hard-coded (dashboard is English-only in pre-release;
//     defer i18n to v1.x)
//   - Bytes: SI 1000-base (KB/MB/GB matches DO/AWS/GCP billing surfaces;
//     not IEC 1024-base KiB/MiB/GiB)
//   - Null safety: return `—` (em-dash) for null/undefined/empty/NaN/Infinity
//
// Bundle: ZERO impact in prod — all helpers use native Intl APIs that Vite-
// targeted browsers ship by default.

const EMDASH = '—';

/**
 * Format an ISO date string for display per intent.
 *
 * @example
 *   formatDate('2026-05-25T06:42:00Z', 'date')     // "May 25, 2026"
 *   formatDate('2026-05-25T06:42:00Z', 'datetime') // "May 25, 2026, 6:42 AM"
 *   formatDate('2026-05-25', 'long')               // "Monday, May 25, 2026"
 *   formatDate(null, 'date')                       // "—"
 *   formatDate('', 'date')                         // "—" (EC-2 guard)
 *   formatDate('invalid', 'date')                  // "—" (Invalid Date guard)
 */
/**
 * Detect the Go `time.Time` zero-value serialized into JSON. Per
 * issue #118 (qa-dogfood-cleanup-2026-06-21 T3.1) the engine used to
 * emit `"0001-01-01T00:00:00Z"` for projects without any builds, which
 * JS truthy-checks pass — so `?:` and `??` guards on the dashboard
 * never fired and the relative-time renderer printed
 * "2,027 years ago" on Overview / project-detail hero.
 *
 * The backend now uses `*time.Time` + `omitempty` so the field is
 * absent on the wire. This helper is the dashboard-side defense in
 * depth that catches the zero literal even if a legacy backend slips
 * through. EC-4 absorption: prefix-match covers RFC3339Nano
 * (`"0001-01-01T00:00:00.000000000Z"`) and `+00:00` suffix variants.
 */
export function isZeroTime(iso: string | undefined | null): boolean {
  if (iso === undefined || iso === null) return true;
  if (iso === '') return true;
  return iso.startsWith('0001-01-01T00:00:00');
}

export function formatDate(
  iso: string | undefined | null,
  intent: 'date' | 'datetime' | 'relative' | 'long',
): string {
  // EC-2: empty string + null + undefined all collapse to em-dash via !iso
  // EC-4 (qa-dogfood-cleanup-2026-06-21 #118): zero-time sentinel too.
  if (!iso || isZeroTime(iso)) return EMDASH;
  const d = new Date(iso);
  // Invalid Date guard — Number.isNaN of date.getTime() is the canonical check
  if (Number.isNaN(d.getTime())) return EMDASH;

  switch (intent) {
    case 'date':
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    case 'datetime':
      return d.toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    case 'relative':
      return relativeTime(d);
    case 'long':
      return d.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
  }
}

/**
 * Relative time formatter ("2h ago", "yesterday", "3 days ago", "in 5 min").
 * Uses Intl.RelativeTimeFormat for proper grammar. Buckets: minute, hour,
 * day, week, month, year.
 */
function relativeTime(d: Date): string {
  const diffMs = d.getTime() - Date.now();
  const absSec = Math.abs(diffMs) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

  if (absSec < 60) return rtf.format(Math.round(diffMs / 1000), 'second');
  if (absSec < 3600) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  if (absSec < 86_400) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  if (absSec < 604_800) return rtf.format(Math.round(diffMs / 86_400_000), 'day');
  if (absSec < 2_592_000) return rtf.format(Math.round(diffMs / 604_800_000), 'week');
  if (absSec < 31_536_000) return rtf.format(Math.round(diffMs / 2_592_000_000), 'month');
  return rtf.format(Math.round(diffMs / 31_536_000_000), 'year');
}

/**
 * Format a number for display per intent.
 *
 * @example
 *   formatNumber(1_240_000, 'compact')   // "1.24M"
 *   formatNumber(1_240_000, 'grouped')   // "1,240,000"
 *   formatNumber(1_500_000, 'bytes')     // "1.5 MB" (SI 1000-base per ADR-D4)
 *   formatNumber(0.423, 'percent')       // "42.3%"
 *   formatNumber(NaN, 'compact')         // "—"
 *   formatNumber(Infinity, 'compact')    // "—" (EC-8 guard)
 *
 * ADR-D4 ratification: `bytes` intent uses SI 1000-base (1 KB = 1000 bytes),
 * NOT IEC 1024-base. Matches DigitalOcean / AWS / GCP billing surface
 * conventions. Edge Requests in Billing shows `1.24M` (1 million, not
 * 1,048,576). Fast Data Transfer shows `412 GB` per SI.
 */
export function formatNumber(
  value: number,
  intent: 'compact' | 'grouped' | 'bytes' | 'percent',
): string {
  // EC-8: NaN + Infinity + -Infinity all collapse via Number.isFinite
  if (!Number.isFinite(value)) return EMDASH;

  switch (intent) {
    case 'compact':
      return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 2,
      }).format(value);
    case 'grouped':
      return new Intl.NumberFormat('en-US').format(value);
    case 'bytes':
      return formatBytes(value);
    case 'percent':
      return new Intl.NumberFormat('en-US', {
        style: 'percent',
        maximumFractionDigits: 1,
      }).format(value);
  }
}

/**
 * SI 1000-base byte formatting per ADR-D4. Returns largest unit ≥ 1.
 *   1500       → "1.5 KB"
 *   1_500_000  → "1.5 MB"
 *   412_000_000_000 → "412 GB"
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let unitIdx = 0;
  let value = bytes;
  while (value >= 1000 && unitIdx < units.length - 1) {
    value /= 1000;
    unitIdx++;
  }
  const formatted = unitIdx === 0
    ? value.toString()
    : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${formatted} ${units[unitIdx]}`;
}

/**
 * Mask email's local part while preserving the full domain. Strong signal
 * of "which account am I logged into" without exposing the local identifier.
 * Per plan v1.1 T-D.1 (P-3 + EC-10 defensive).
 *
 * @example
 *   maskEmail('demo@usetheo.dev')        // "d***@usetheo.dev"
 *   maskEmail('a@b.com')                 // "*@b.com"            (single-char local)
 *   maskEmail('verylonglocalpart@x.com') // "v********@x.com"    (capped at 8 stars)
 *   maskEmail('john@doe@malformed.com')  // "john@doe@malformed.com" (EC-10 passthrough)
 *   maskEmail('x@')                      // "x@"                 (no domain)
 *   maskEmail('@y.com')                  // "@y.com"             (empty local)
 */
export function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return email;   // EC-10: multi-@ defensive passthrough
  const [local, domain] = parts;
  if (!domain) return email;               // "x@" → no domain
  if (local.length === 0) return email;    // "@y.com" → empty local
  if (local.length === 1) return `*@${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(local.length - 1, 8))}@${domain}`;
}

/**
 * Red Team theo-cloud#52/#78 closure: humanize a backend "author" field
 * (e.g. `created_by` on builds) which can arrive as a UUID, an email,
 * or an already-friendly display name. The Red Team caught the
 * /deployments table rendering verbatim UUIDs ("4d6ae2dd-baa2-…") on
 * every row.
 *
 * Rules (cheapest-first):
 *   1. `null` / empty → '—'
 *   2. UUID (canonical 8-4-4-4-12 hex) → first 8 chars (e.g. "4d6ae2dd")
 *      so duplicates STILL look distinct AND the original is preserved in
 *      a `title` tooltip at the call site.
 *   3. email → local-part (e.g. "paulo@usetheo.dev" → "paulo")
 *   4. anything else (a real name like "Paulo Henrique") → as-is.
 *
 * @example
 *   humanizeAuthor('4d6ae2dd-baa2-4c01-8d33-a96e20c23d1a') // "4d6ae2dd"
 *   humanizeAuthor('paulo@usetheo.dev')                    // "paulo"
 *   humanizeAuthor('Paulo Henrique')                       // "Paulo Henrique"
 *   humanizeAuthor('')                                     // "—"
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function humanizeAuthor(raw: string | null | undefined): string {
  if (!raw) return EMDASH;
  const trimmed = raw.trim();
  if (!trimmed) return EMDASH;
  if (UUID_PATTERN.test(trimmed)) return trimmed.slice(0, 8);
  // Email — assume the simplest form `local@domain`; multi-@ malformed
  // strings fall through to the as-is branch.
  const at = trimmed.indexOf('@');
  if (at > 0 && at === trimmed.lastIndexOf('@')) {
    return trimmed.slice(0, at);
  }
  return trimmed;
}
