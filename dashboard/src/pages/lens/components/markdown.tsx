import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { Button } from '@getloopscale/ui';

/**
 * M98 (D-H2) — the sanitized markdown wrapper, extracted from `io-cards` into its own module so a
 * consumer that only needs Markdown (the Ask thread) no longer transitively bundles CodeMirror + the
 * `@codemirror/*` packages that `io-cards` also imports. This is the ONLY `react-markdown` import site.
 *
 * XSS invariant (D5 / R2 — load-bearing): `rehype-sanitize` (default schema) strips `<script>`, event
 * handlers, and `javascript:` URLs; never `dangerouslySetInnerHTML`.
 */

// Size guard: a markdown body longer than this many characters is truncated with a "Show more"
// affordance so a pathological megabyte-string payload cannot lock the render.
const MAX_MARKDOWN_CHARS = 8000;

/**
 * Render `source` as sanitized markdown. Empty string → renders nothing; plain text → verbatim. Over
 * the size guard the body truncates behind a "Show more" toggle (never silently dropped).
 */
export function Markdown({ source }: { source: string }) {
  const [expanded, setExpanded] = useState(false);
  if (source === '') return null;

  const oversized = source.length > MAX_MARKDOWN_CHARS;
  const shown = oversized && !expanded ? source.slice(0, MAX_MARKDOWN_CHARS) : source;

  return (
    <div className="space-y-1">
      <div className="prose prose-sm dark:prose-invert max-w-none break-words text-xs" data-testid="markdown-body">
        <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{shown}</ReactMarkdown>
      </div>
      {oversized ? (
        <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : `Show more (${source.length - MAX_MARKDOWN_CHARS} more chars)`}
        </Button>
      ) : null}
    </div>
  );
}
