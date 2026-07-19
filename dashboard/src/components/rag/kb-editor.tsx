import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BubbleMenu, EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';

import { filterSlashItems, parseSlash, type SlashItem } from './kb-editor-slash';

/**
 * KbEditor (KB3 + KB11) — the Notion-style block editor for Knowledge Base wiki pages.
 * TipTap (headless) + StarterKit gives block editing with markdown input rules ("# " →
 * heading, "- " → list, "```" → code, "> " → quote); `tiptap-markdown` round-trips the
 * document to OKF markdown so the wire contract (create/update endpoints consume a markdown
 * string) is unchanged.
 *
 * KB11 affordances (Notion parity): a **bubble menu** on text selection (bold / italic /
 * strike / inline-code / H1 / H2) and a **slash menu** — typing "/" on an empty block opens
 * an insert palette (headings, lists, quote, code). The open/close + filter LOGIC lives in
 * `kb-editor-slash.ts` (pure, unit-tested); this component owns POSITIONING + keyboard nav.
 *
 * `value` is markdown; `onChange` emits markdown. External `value` changes reset the document
 * only while the editor is not focused, so a live edit is never clobbered by a re-render.
 */
export interface KbEditorProps {
  readonly value: string;
  readonly editable?: boolean;
  readonly onChange?: (markdown: string) => void;
  /** Fill the parent's height (flex column that grows + scrolls internally) instead of the
   * default fixed `min-h-[240px]`. Use inside a tall container (e.g. the New page modal). */
  readonly fill?: boolean;
  /** Document theme for the editing surface: `system` (dark, follows the app) or `white`
   * (light paper surface even in the dark app). Defaults to `system`. */
  readonly theme?: 'system' | 'white';
}

interface SlashState {
  readonly items: readonly SlashItem[];
  readonly active: number;
  readonly top: number;
  readonly left: number;
  readonly tokenLen: number;
}

function textBeforeCaret(editor: Editor): string {
  const { $from } = editor.state.selection;
  return $from.parent.textBetween(0, $from.parentOffset, '\n', '￼');
}

export function KbEditor({ value, editable = true, onChange, fill = false, theme = 'system' }: KbEditorProps) {
  const [slash, setSlash] = useState<SlashState | null>(null);
  const slashRef = useRef<SlashState | null>(null);
  slashRef.current = slash;
  const editorRef = useRef<Editor | null>(null);

  const refreshSlash = useCallback((editor: Editor) => {
    const { selection } = editor.state;
    if (!selection.empty) {
      setSlash(null);
      return;
    }
    const query = parseSlash(textBeforeCaret(editor));
    if (query === null) {
      setSlash(null);
      return;
    }
    const items = filterSlashItems(query);
    const coords = editor.view.coordsAtPos(selection.$from.pos);
    setSlash({ items, active: 0, top: coords.bottom + 4, left: coords.left, tokenLen: query.length + 1 });
  }, []);

  const applyItem = useCallback((editor: Editor, item: SlashItem, tokenLen: number) => {
    const to = editor.state.selection.$from.pos;
    const from = to - tokenLen;
    editor.chain().focus().deleteRange({ from, to }).run();
    item.apply(editor);
    setSlash(null);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      // KB12 — interactive checklists that round-trip to GFM `- [ ]` markdown.
      TaskList,
      TaskItem.configure({ nested: true }),
      // KB12 — empty-block placeholder ("Type / for commands…").
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === 'paragraph' ? "Type '/' for commands…" : '',
      }),
      Markdown.configure({ html: false, linkify: true }),
    ],
    content: value,
    editable,
    // KB12 — auto-focus at the end when the editor is editable (create/edit surfaces).
    autofocus: editable ? 'end' : false,
    editorProps: {
      attributes: {
        class: [
          fill
            ? 'prose prose-sm h-full min-h-0 max-w-none overflow-y-auto rounded-md border border-border p-3 focus:outline-none'
            : 'prose prose-sm min-h-[240px] max-w-none rounded-md border border-border p-3 focus:outline-none',
          // Theme (kept in sync at runtime by the effect below when it toggles):
          theme === 'white' ? 'prose-doc-white bg-white' : 'bg-background dark:prose-invert',
        ].join(' '),
        'data-testid': 'kb-editor',
        'aria-label': 'Page editor',
      },
      handleKeyDown: (_view, event) => {
        const st = slashRef.current;
        const ed = editorRef.current;
        if (st === null || ed === null || st.items.length === 0) return false;
        if (event.key === 'ArrowDown') {
          setSlash({ ...st, active: (st.active + 1) % st.items.length });
          return true;
        }
        if (event.key === 'ArrowUp') {
          setSlash({ ...st, active: (st.active - 1 + st.items.length) % st.items.length });
          return true;
        }
        if (event.key === 'Enter') {
          applyItem(ed, st.items[st.active], st.tokenLen);
          return true;
        }
        if (event.key === 'Escape') {
          setSlash(null);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange?.(e.storage.markdown.getMarkdown());
      refreshSlash(e);
    },
    onSelectionUpdate: ({ editor: e }) => refreshSlash(e),
  });

  editorRef.current = editor;

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  // Keep the editing surface in sync with the document theme when it toggles at runtime
  // (the editor is created once, so the initial class alone would not react to changes).
  useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    if (theme === 'white') {
      dom.classList.add('prose-doc-white', 'bg-white');
      dom.classList.remove('bg-background', 'dark:prose-invert');
    } else {
      dom.classList.add('bg-background', 'dark:prose-invert');
      dom.classList.remove('prose-doc-white', 'bg-white');
    }
  }, [editor, theme]);

  useEffect(() => {
    if (editor === null || editor.isFocused) return;
    const current = editor.storage.markdown.getMarkdown();
    if (current.trim() !== value.trim()) {
      editor.commands.setContent(value, false);
    }
  }, [value, editor]);

  const btn = 'rounded px-2 py-1 text-sm hover:bg-muted';
  const activeBtn = (on: boolean) => `${btn} ${on ? 'bg-muted text-primary' : ''}`;

  return (
    <div className={fill ? 'relative flex min-h-0 flex-1 flex-col' : 'relative'}>
      {editor ? (
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 100 }}
          className="flex items-center gap-0.5 rounded-md border border-border bg-card p-1 shadow-md"
          data-testid="kb-bubble-menu"
        >
          <button type="button" className={activeBtn(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Bold">
            B
          </button>
          <button type="button" className={`${activeBtn(editor.isActive('italic'))} italic`} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic">
            i
          </button>
          <button type="button" className={`${activeBtn(editor.isActive('strike'))} line-through`} onClick={() => editor.chain().focus().toggleStrike().run()} aria-label="Strikethrough">
            S
          </button>
          <button type="button" className={`${activeBtn(editor.isActive('code'))} font-mono`} onClick={() => editor.chain().focus().toggleCode().run()} aria-label="Inline code">
            {'</>'}
          </button>
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
          <button type="button" className={activeBtn(editor.isActive('heading', { level: 1 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} aria-label="Heading 1">
            H1
          </button>
          <button type="button" className={activeBtn(editor.isActive('heading', { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} aria-label="Heading 2">
            H2
          </button>
        </BubbleMenu>
      ) : null}

      <EditorContent editor={editor} className={fill ? 'flex min-h-0 flex-1 flex-col' : undefined} />

      {/* Portal past the modal: the slash menu is `position: fixed` at the caret's viewport
          coords, but a transformed ancestor (the centered modal's translate) makes `fixed`
          resolve against the modal instead of the viewport, throwing the menu off. Render it
          under the theme root (`.dark`, an un-transformed ancestor) — NOT `document.body`,
          which sits OUTSIDE the theme and would drop the menu's colours to :root (invisible
          dark text). This fixes both the position AND keeps the app theme. */}
      {slash && editor
        ? createPortal(
        <div
          role="listbox"
          aria-label="Insert block"
          data-testid="kb-slash-menu"
          className="fixed z-50 w-56 overflow-hidden rounded-md border border-border bg-card py-1 text-foreground shadow-lg"
          style={{ top: slash.top, left: slash.left }}
        >
          {slash.items.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
          ) : (
            slash.items.map((it, i) => (
              <button
                key={it.id}
                type="button"
                role="option"
                aria-selected={i === slash.active}
                className={`flex w-full items-center px-3 py-1.5 text-left text-sm hover:bg-muted ${i === slash.active ? 'bg-muted' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyItem(editor, it, slash.tokenLen);
                }}
              >
                {it.label}
              </button>
            ))
          )}
        </div>,
            slashPortalRoot(),
          )
        : null}
    </div>
  );
}

/** The theme-aware, un-transformed portal target for the slash menu: the nearest theme root
 * (`.dark` / `[data-mode]`) so the menu keeps the app's colours, falling back to `<body>`. */
function slashPortalRoot(): HTMLElement {
  if (typeof document === 'undefined') return null as unknown as HTMLElement;
  return (document.querySelector('.dark, [data-mode]') as HTMLElement | null) ?? document.body;
}
