import { tagColorClasses } from './tag-color';

/**
 * TagChip — a wiki page tag rendered as a colored pill. The colour is derived from the tag
 * name (see tag-color.ts), so tags are consistently coloured everywhere without any stored
 * per-tag colour. Used in the New page rail preview and the reader's OKF header.
 */
export function TagChip({ name }: { readonly name: string }) {
  return (
    <span
      data-testid="tag-chip"
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tagColorClasses(name)}`}
    >
      {name}
    </span>
  );
}
