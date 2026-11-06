/**
 * Tipos e helpers puros do Workspace.
 *
 * Moram aqui, e nao em `../workspace.tsx`, porque `use-workspace-selection.ts` e
 * `workspace-preview-sheet.tsx` precisam deles: consumir dominio a partir da
 * propria pagina fechava os dois ciclos que o `madge --circular` reportava
 * (B-038). Uma pagina deve importar dominio, nao exporta-lo.
 *
 * `../workspace.tsx` re-exporta o que esta aqui, entao `@/pages/workspace`
 * continua sendo a superficie publica e nenhum consumidor externo mudou.
 */

export interface StorageFile {
  path: string;
  size: number;
  content_type: string;
}

/** Empty marker object that makes an otherwise-empty folder visible; hidden from the file list. */
export const FOLDER_MARKER = '.keep';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export interface WorkspaceEntries {
  folders: string[];
  files: StorageFile[];
}

/**
 * Split a flat object list into the folders and files that live directly under
 * `prefix` (e.g. `""` for root, `"data/"` for a subfolder). Keys deeper than this
 * level contribute their first segment as a folder; the `.keep` marker is hidden.
 */

export function deriveEntries(all: StorageFile[], prefix: string): WorkspaceEntries {
  const folders = new Set<string>();
  const files: StorageFile[] = [];
  for (const f of all) {
    if (!f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    if (rest === '') continue;
    const slash = rest.indexOf('/');
    if (slash === -1) {
      if (rest === FOLDER_MARKER) continue;
      files.push(f);
    } else {
      folders.add(rest.slice(0, slash));
    }
  }
  return {
    folders: [...folders].sort((a, b) => a.localeCompare(b)),
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export type PreviewKind = 'text' | 'image' | 'none';

export function previewKind(ct: string): PreviewKind {
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('text/') || /(json|javascript|typescript|xml|yaml|markdown|csv|x-sh|html)/i.test(ct)) return 'text';
  return 'none';
}
