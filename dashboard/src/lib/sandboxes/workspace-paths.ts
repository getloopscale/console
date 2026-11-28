/** Where the files of a sandbox live. The file routes refuse a path outside it. */
export const WORKSPACE_ROOT = '/workspace';

/** A step of the trail from the workspace to a directory. */
interface Crumb {
  label: string;
  path: string;
}

/** The directories from the workspace down to `path`, the workspace first. */
export function crumbs(path: string): Crumb[] {
  const below = path.slice(WORKSPACE_ROOT.length).split('/').filter(Boolean);
  const trail: Crumb[] = [{ label: 'workspace', path: WORKSPACE_ROOT }];
  for (const name of below) {
    trail.push({ label: name, path: `${trail[trail.length - 1].path}/${name}` });
  }
  return trail;
}

/** The path of an entry of a directory. */
export function childPath(directory: string, name: string): string {
  return `${directory.replace(/\/+$/, '')}/${name}`;
}

/** A path as the file route takes it: no leading slash, each segment encoded. */
export function encodedFilePath(path: string): string {
  return path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
}

interface Entry {
  name: string;
  is_dir: boolean;
}

/** Directories first, then files, each group by name. */
export function sortedEntries<T extends Entry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name));
}
