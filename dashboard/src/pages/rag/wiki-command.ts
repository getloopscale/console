import type { CommandItem } from '@usetheo/ui';

/**
 * Wiki command-palette model (KB14). Maps the loaded wiki pages to CommandPalette items so
 * Cmd+K can jump to any page. Pure + unit-tested; the palette open state + keyboard shortcut
 * live in the page component. `searchable` carries the full OKF path so a query like "api/auth"
 * ranks the nested page even though the visible label is just the leaf name.
 */

export interface WikiCommandPage {
  readonly id: string;
  readonly name: string;
  readonly type?: string;
}

function leaf(path: string): string {
  const parts = path.split('/').filter((s) => s !== '');
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function folder(path: string): string {
  const parts = path.split('/').filter((s) => s !== '');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

export function toCommandItems(pages: readonly WikiCommandPage[]): CommandItem[] {
  return pages.map((p) => {
    const hintParts = [folder(p.name), p.type && p.type !== 'concept' ? p.type : '']
      .filter((s) => s !== '')
      .join(' · ');
    return {
      id: p.id,
      label: leaf(p.name),
      hint: hintParts === '' ? undefined : hintParts,
      searchable: p.name,
    };
  });
}
