import { type KeyboardEvent, useState } from 'react';
import { X } from 'lucide-react';
import { parseTags, setTagColorOverride, tagColorClasses, tagColorIndex, TAG_PALETTE, useTagColors } from './tag-color';

/**
 * TagInput — a proper tag-entry field for wiki pages. Type a tag and press Enter (or type a
 * comma) to add it as a colored chip; chips accumulate; the X removes one; Backspace on an
 * empty input removes the last. Click a chip to change its colour from the palette (a LOCAL
 * per-tag preference — the page still stores plain tag strings, see tag-color.ts).
 *
 * Value is a comma-separated string (matching the OKF `tags` shape); `onChange` emits the same.
 */
export function TagInput({ value, onChange }: { readonly value: string; readonly onChange: (value: string) => void }) {
  useTagColors();
  const tags = parseTags(value);
  const [draft, setDraft] = useState('');
  const [picker, setPicker] = useState<string | null>(null);

  const commit = (raw: string) => {
    const next = parseTags([...tags, raw].join(','));
    onChange(next.join(', '));
    setDraft('');
  };
  const remove = (t: string) => onChange(tags.filter((x) => x.toLowerCase() !== t.toLowerCase()).join(', '));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (draft.trim() !== '') commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      remove(tags[tags.length - 1]);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring">
      {tags.map((t) => (
        <span
          key={t}
          className={`relative inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tagColorClasses(t)}`}
        >
          <button
            type="button"
            onClick={() => setPicker(picker === t ? null : t)}
            title="Change colour"
            aria-label={`Change colour of ${t}`}
            className="cursor-pointer"
          >
            {t}
          </button>
          <button
            type="button"
            onClick={() => {
              if (picker === t) setPicker(null);
              remove(t);
            }}
            aria-label={`Remove ${t}`}
            className="opacity-70 hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
          {picker === t ? (
            <div
              className="absolute left-0 top-full z-20 mt-1 flex gap-1 rounded-md border border-border bg-card p-1.5 shadow-lg"
              role="listbox"
              aria-label={`Colour for ${t}`}
            >
              {TAG_PALETTE.map((c, i) => (
                <button
                  key={c.label}
                  type="button"
                  role="option"
                  aria-selected={tagColorIndex(t) === i}
                  aria-label={`${c.label} for ${t}`}
                  onClick={() => {
                    setTagColorOverride(t, i);
                    setPicker(null);
                  }}
                  className={`h-4 w-4 rounded-full ${c.swatch} ${
                    tagColorIndex(t) === i ? 'ring-2 ring-foreground ring-offset-1 ring-offset-card' : ''
                  }`}
                />
              ))}
            </div>
          ) : null}
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          // typing a comma commits the tag before the comma
          if (v.endsWith(',')) commit(v.slice(0, -1));
          else setDraft(v);
        }}
        onKeyDown={onKeyDown}
        placeholder={tags.length > 0 ? 'Add tag…' : 'Add tags (Enter or comma)'}
        aria-label="Page tags"
        className="min-w-[6rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
