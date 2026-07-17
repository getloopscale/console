import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { CodeBlock } from './code-block';

/**
 * MarkdownView — the document-reading markdown renderer for the Knowledge Base (KB1
 * reading foundation). Renders sanitized markdown with GitHub-flavored extensions
 * (tables, task lists, strikethrough) at doc-reading prose scale, replacing the plain
 * `<pre>` dumps the wiki reader used before. KB10 upgrades fenced code blocks to a
 * syntax-highlighted, copyable CodeBlock while inline code stays a plain chip.
 *
 * XSS invariant (load-bearing): `rehype-sanitize` (default schema) strips `<script>`,
 * event handlers, and `javascript:` URLs; this component never uses
 * `dangerouslySetInnerHTML`. The KB10 CodeBlock renders React nodes from the raw code
 * string (react-syntax-highlighter), so it introduces no innerHTML path. Do NOT remove
 * the sanitize plugin.
 */

function codeText(children: ReactNode): string {
  return String(children ?? '').replace(/\n$/, '');
}

/** react-markdown v9 renders both inline and fenced code through `code`. A fenced block
 * carries a `language-*` class OR spans multiple lines; inline code is single-line and
 * class-less. We route the former to the highlighted CodeBlock and keep the latter inline. */
function CodeRenderer({ className, children, ...rest }: ComponentPropsWithoutRef<'code'>) {
  const match = /language-(\w+)/.exec(className ?? '');
  const text = codeText(children);
  const isBlock = match !== null || text.includes('\n');
  if (isBlock) {
    return <CodeBlock code={text} language={match?.[1]} />;
  }
  return (
    <code className={className} {...rest}>
      {children}
    </code>
  );
}

export function MarkdownView({ source }: { source: string }) {
  if (source.trim() === '') return null;
  return (
    <div
      className="prose prose-sm max-w-none break-words dark:prose-invert"
      data-testid="kb-markdown"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          code: CodeRenderer,
          // CodeBlock supplies its own panel <div>; unwrap react-markdown's <pre> so we
          // don't nest a block-level element inside a <pre>.
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
