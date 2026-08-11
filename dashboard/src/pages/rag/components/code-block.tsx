import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { CopyButton } from '@usetheo/ui';

/**
 * CodeBlock (KB10) — the code-block renderer for the Knowledge Base markdown reader.
 * Syntax highlighting via react-syntax-highlighter's PrismLight (a mature, maintained
 * library — do NOT hand-roll a tokenizer, Rule 9) plus a CopyButton (reused from
 * @usetheo/ui — rung 4 of the parsimony ladder, do NOT reinvent) revealed on hover.
 *
 * Why PrismLight (sync) over PrismAsync: async language chunks load via dynamic import,
 * which is non-deterministic under jsdom (vitest) and adds runtime waterfalls. Registering
 * a fixed language set keeps the bundle bounded AND the tests deterministic. Unknown
 * languages fall back to `text` (no highlight) rather than throwing.
 *
 * `not-prose` opts this block out of the KB9 typography theme so the highlighter's own
 * <pre>/<code> styling is not double-applied; the wrapper supplies the panel chrome.
 */

// Register only the languages the wiki realistically uses — bounded bundle cost.
const LANGUAGES: Record<string, Parameters<typeof SyntaxHighlighter.registerLanguage>[1]> = {
  bash,
  sh: bash,
  shell: bash,
  go,
  javascript,
  js: javascript,
  json,
  markup,
  html: markup,
  xml: markup,
  python,
  py: python,
  sql,
  tsx,
  typescript,
  ts: typescript,
  yaml,
  yml: yaml,
};
for (const [name, def] of Object.entries(LANGUAGES)) {
  SyntaxHighlighter.registerLanguage(name, def);
}

const REGISTERED = new Set(Object.keys(LANGUAGES));

export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const lang = language && REGISTERED.has(language) ? language : 'text';
  return (
    <div
      className="not-prose group relative my-4 overflow-hidden rounded-lg border border-border bg-muted"
      data-testid="kb-code-block"
    >
      <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <CopyButton value={code} aria-label="Copy code" />
      </div>
      <SyntaxHighlighter
        language={lang}
        style={oneDark}
        PreTag="div"
        customStyle={{
          background: 'transparent',
          margin: 0,
          padding: '0.85rem 1rem',
          fontSize: '0.8125rem',
          lineHeight: 1.6,
        }}
        codeTagProps={{
          style: { fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)' },
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
