import type { Editor } from '@tiptap/react';

/**
 * Slash-menu model for the KbEditor (KB11). Kept separate from the React component so the
 * open/close decision (`parseSlash`) and the item filter (`filterSlashItems`) are pure and
 * unit-testable — floating-menu POSITIONING depends on real layout and is proven LIVE, but
 * the LOGIC that decides "is the user typing a slash command right now?" is deterministic.
 */

export interface SlashItem {
  readonly id: string;
  readonly label: string;
  /** extra words that also match the query (e.g. "todo" for the checklist item). */
  readonly keywords: readonly string[];
  /** run the block transform; the leading "/query" text has already been removed. */
  readonly apply: (editor: Editor) => void;
}

/**
 * Returns the slash query (text after "/") when the caret sits in a block whose text before
 * the caret is exactly "/word" (letters only, no spaces) — i.e. the user opened a slash
 * command and is still typing its name. Returns null otherwise (no slash, a space was typed,
 * or the caret is mid-paragraph after other text).
 */
export function parseSlash(textBeforeCaret: string): string | null {
  const m = /(?:^|\s)\/([a-zA-Z]*)$/.exec(textBeforeCaret);
  if (m === null) return null;
  // Only trigger when the slash is the whole block content or follows whitespace, AND the
  // block is otherwise empty before the slash token (so "path/to" never triggers a menu).
  const beforeSlash = textBeforeCaret.slice(0, textBeforeCaret.length - m[0].length + (m[0].startsWith('/') ? 0 : 1));
  if (beforeSlash.trim() !== '') return null;
  return m[1];
}

/** The canonical insert palette. Order is the display order in the menu. */
export const SLASH_ITEMS: readonly SlashItem[] = [
  {
    id: 'h1',
    label: 'Heading 1',
    keywords: ['title', 'h1'],
    apply: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    keywords: ['subtitle', 'h2'],
    apply: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    keywords: ['h3'],
    apply: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet',
    label: 'Bulleted list',
    keywords: ['ul', 'unordered', 'list'],
    apply: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'ordered',
    label: 'Numbered list',
    keywords: ['ol', 'ordered', 'number'],
    apply: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'quote',
    label: 'Quote',
    keywords: ['blockquote', 'callout'],
    apply: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'code',
    label: 'Code block',
    keywords: ['pre', 'snippet'],
    apply: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
];

/** Filter the palette by the slash query (case-insensitive, matches label or keywords). */
export function filterSlashItems(query: string): readonly SlashItem[] {
  const q = query.trim().toLowerCase();
  if (q === '') return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (it) => it.label.toLowerCase().includes(q) || it.keywords.some((k) => k.includes(q)),
  );
}
