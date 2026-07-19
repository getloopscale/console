import { useSyncExternalStore } from 'react';

/**
 * Colored wiki tags. A page's OKF `tags` are plain strings and the data-plane drops any
 * unknown OKF field, so a per-tag colour CANNOT be stored on the page. The colour is instead:
 *   1. an optional LOCAL override the user picks (persisted in localStorage, keyed by tag
 *      name — applies to that tag on every page, per browser), else
 *   2. a stable colour DERIVED from the tag name (hash → curated palette).
 * Either way the tag itself stays a plain string, so it round-trips for free.
 *
 * NOTE (Tailwind v4): every colour class MUST be a full literal so the compiler emits it.
 */

export interface TagColor {
  /** Chip classes: bg tint + readable text + subtle border (dark-chrome friendly). */
  readonly chip: string;
  /** Solid swatch bg for the colour-picker button. */
  readonly swatch: string;
  /** Human name (for the picker's aria-label). */
  readonly label: string;
}

/** Curated 8-colour palette. */
export const TAG_PALETTE: readonly TagColor[] = [
  { chip: 'bg-neutral-500/15 text-neutral-300 border-neutral-500/30', swatch: 'bg-neutral-500', label: 'Gray' },
  { chip: 'bg-red-500/15 text-red-300 border-red-500/30', swatch: 'bg-red-500', label: 'Red' },
  { chip: 'bg-orange-500/15 text-orange-300 border-orange-500/30', swatch: 'bg-orange-500', label: 'Orange' },
  { chip: 'bg-yellow-500/15 text-yellow-200 border-yellow-500/30', swatch: 'bg-yellow-500', label: 'Yellow' },
  { chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', swatch: 'bg-emerald-500', label: 'Green' },
  { chip: 'bg-blue-500/15 text-blue-300 border-blue-500/30', swatch: 'bg-blue-500', label: 'Blue' },
  { chip: 'bg-purple-500/15 text-purple-300 border-purple-500/30', swatch: 'bg-purple-500', label: 'Purple' },
  { chip: 'bg-pink-500/15 text-pink-300 border-pink-500/30', swatch: 'bg-pink-500', label: 'Pink' },
];

const OVERRIDE_KEY = 'theo:wiki:tag-colors';

function readOverrides(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(OVERRIDE_KEY) ?? '{}') as Record<string, number>;
    return typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    return {};
  }
}

let overrides = readOverrides();
const listeners = new Set<() => void>();
let version = 0;

function persist(): void {
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(overrides));
  } catch {
    // non-persistent (private mode) — the in-memory override still drives this session.
  }
  version += 1;
  listeners.forEach((l) => l());
}

/** Set a user's colour override for a tag (by name). */
export function setTagColorOverride(name: string, index: number): void {
  overrides = { ...overrides, [name.trim().toLowerCase()]: ((index % TAG_PALETTE.length) + TAG_PALETTE.length) % TAG_PALETTE.length };
  persist();
}

/** Stable index into the palette from the tag name (case-insensitive) — the auto colour. */
function hashIndex(name: string): number {
  let h = 0;
  const s = name.trim().toLowerCase();
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % TAG_PALETTE.length;
}

/** Resolved palette index for a tag: local override if any, else the derived colour. */
export function tagColorIndex(name: string): number {
  const key = name.trim().toLowerCase();
  return key in overrides ? overrides[key] : hashIndex(name);
}

/** Chip Tailwind classes (bg + text + border) for a tag. */
export function tagColorClasses(name: string): string {
  return TAG_PALETTE[tagColorIndex(name)].chip;
}

/** Subscribe to override changes (returns a version that ticks on every change). */
export function useTagColors(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => 0,
  );
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
