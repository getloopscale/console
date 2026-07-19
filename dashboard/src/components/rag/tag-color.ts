/**
 * Deterministic colored tags for wiki pages. A page's OKF `tags` are plain strings, so the
 * colour is DERIVED from the tag name (stable — the same tag is always the same colour, on
 * every page) rather than stored. This needs no OKF/data-plane schema change and round-trips
 * for free. The palette is a curated fixed set with good contrast on the dark chrome.
 *
 * NOTE (Tailwind v4): the class strings MUST be full literals so the compiler emits them —
 * never build a colour class by interpolation.
 */

/** Curated 8-colour palette (bg tint + readable text + subtle border), dark-chrome friendly. */
const TAG_PALETTE: readonly string[] = [
  'bg-neutral-500/15 text-neutral-300 border-neutral-500/30',
  'bg-red-500/15 text-red-300 border-red-500/30',
  'bg-orange-500/15 text-orange-300 border-orange-500/30',
  'bg-yellow-500/15 text-yellow-200 border-yellow-500/30',
  'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'bg-blue-500/15 text-blue-300 border-blue-500/30',
  'bg-purple-500/15 text-purple-300 border-purple-500/30',
  'bg-pink-500/15 text-pink-300 border-pink-500/30',
];

/** Stable index into the palette from the tag name (case-insensitive). */
function hashIndex(name: string): number {
  let h = 0;
  const s = name.trim().toLowerCase();
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % TAG_PALETTE.length;
}

/** Tailwind classes (bg + text + border) for a tag chip of the given name. */
export function tagColorClasses(name: string): string {
  return TAG_PALETTE[hashIndex(name)];
}

/** Parse a comma-separated tags string into a clean, de-duplicated list. */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw.split(',')) {
    const v = t.trim();
    if (v !== '' && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}
