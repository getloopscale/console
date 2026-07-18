/**
 * Wiki folder-browser model (single-list redesign). A wiki page's `name` is its OKF
 * path (e.g. `api/auth.md`); a "folder" is just a path prefix. This mirrors the
 * Workspace folder browser (virtual folders over object-storage keys) so the two
 * surfaces share one spatial model. `deriveWikiEntries` returns the folders + pages
 * that live DIRECTLY under a prefix — one level at a time, breadcrumb-navigable.
 * Kept pure so "what shows in this folder" is unit-testable without React.
 */

export interface WikiEntry {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly type?: string;
  readonly updated_at?: string;
}

export interface WikiEntries {
  readonly folders: readonly string[];
  readonly pages: readonly WikiEntry[];
}

/** Empty-folder marker (hidden from the page list) — a New-folder creates one so an
 * otherwise-empty folder is visible, exactly like the Workspace `.keep` convention. */
export const WIKI_FOLDER_MARKER = '.keep';

/** Folders + pages directly under `prefix` (e.g. '' for root, 'api/' for a subfolder).
 * A page deeper than this level contributes its next path segment as a folder; the
 * `.keep` marker is hidden. Deterministic: folders + pages sorted by name. */
export function deriveWikiEntries(all: readonly WikiEntry[], prefix: string): WikiEntries {
  const folders = new Set<string>();
  const pages: WikiEntry[] = [];
  for (const p of all) {
    if (!p.name.startsWith(prefix)) continue;
    const rest = p.name.slice(prefix.length);
    if (rest === '') continue;
    const slash = rest.indexOf('/');
    if (slash === -1) {
      if (rest === WIKI_FOLDER_MARKER) continue; // hidden marker → its folder shows via siblings
      pages.push(p);
    } else {
      folders.add(rest.slice(0, slash));
    }
  }
  return {
    folders: [...folders].sort((a, b) => a.localeCompare(b)),
    pages: pages.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** The leaf (last path segment) of a page name, for display in the browser + reader. */
export function leafName(path: string): string {
  const parts = path.split('/').filter((s) => s !== '');
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/** Breadcrumb segments for a prefix ('api/auth/' → ['api', 'auth']). */
export function breadcrumbSegments(prefix: string): string[] {
  return prefix.split('/').filter((s) => s !== '');
}

/** The prefix for the breadcrumb crumb at index i (inclusive), with a trailing slash. */
export function prefixForCrumb(prefix: string, index: number): string {
  const segs = breadcrumbSegments(prefix);
  return segs.slice(0, index + 1).join('/') + '/';
}
