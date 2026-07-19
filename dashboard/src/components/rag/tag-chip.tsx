import { tagColorClasses, useTagColors } from './tag-color';

/**
 * TagChip — a read-only wiki page tag rendered as a colored pill (used in the reader's OKF
 * header). The colour follows the tag's resolved colour (local override, else derived from
 * the name); it subscribes so it re-renders when the user changes a colour.
 */
export function TagChip({ name }: { readonly name: string }) {
  useTagColors();
  return (
    <span
      data-testid="tag-chip"
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tagColorClasses(name)}`}
    >
      {name}
    </span>
  );
}
