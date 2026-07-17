import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

/**
 * KbEditor (KB3) — the Notion-style block editor for Knowledge Base wiki pages. TipTap
 * (headless) + StarterKit gives block editing with markdown input rules ("# " → heading,
 * "- " → list, "```" → code, "> " → quote); `tiptap-markdown` round-trips the document to
 * OKF markdown so the wire contract (the create/update endpoints consume a markdown string)
 * is unchanged. Styled with the app prose tokens so it looks like Theo, not a vendor editor.
 *
 * `value` is markdown; `onChange` emits markdown. External `value` changes (loading a page
 * to edit) reset the document only while the editor is not focused, so a live edit is never
 * clobbered by a re-render.
 */
export interface KbEditorProps {
  readonly value: string;
  readonly editable?: boolean;
  readonly onChange?: (markdown: string) => void;
}

export function KbEditor({ value, editable = true, onChange }: KbEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit, Markdown.configure({ html: false, linkify: true })],
    content: value,
    editable,
    editorProps: {
      attributes: {
        class:
          'prose prose-sm min-h-[240px] max-w-none rounded-md border border-border bg-background p-3 focus:outline-none dark:prose-invert',
        'data-testid': 'kb-editor',
        'aria-label': 'Page editor',
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange?.(e.storage.markdown.getMarkdown());
    },
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    if (editor === null || editor.isFocused) return;
    const current = editor.storage.markdown.getMarkdown();
    if (current.trim() !== value.trim()) {
      editor.commands.setContent(value, false);
    }
  }, [value, editor]);

  return <EditorContent editor={editor} />;
}
