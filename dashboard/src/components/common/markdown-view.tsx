import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

/**
 * MarkdownView — the document-reading markdown renderer for the Knowledge Base (KB1
 * reading foundation). Renders sanitized markdown with GitHub-flavored extensions
 * (tables, task lists, strikethrough) at doc-reading prose scale, replacing the plain
 * `<pre>` dumps the wiki reader used before.
 *
 * XSS invariant (load-bearing): `rehype-sanitize` (default schema) strips `<script>`,
 * event handlers, and `javascript:` URLs; this component never uses
 * `dangerouslySetInnerHTML`. Do NOT remove the sanitize plugin.
 */
export function MarkdownView({ source }: { source: string }) {
  if (source.trim() === '') return null;
  return (
    <div
      className="prose prose-sm max-w-none break-words dark:prose-invert"
      data-testid="kb-markdown"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
