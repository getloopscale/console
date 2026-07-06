import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { Badge, Button, Card, CopyButton } from '@usetheo/ui';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';

import { asChat, prettyValue, type ChatMessage, type ToolCall } from './helpers';

/**
 * M58 P3 — the IO rendering for a span's input/output (ADR D5, blueprint §4). Upgrades the old
 * `ValueBlock`/`ChatView` in `./tree`: role-labeled bordered Cards (NOT chat bubbles) with a sanitized
 * Markdown body + a raw-JSON CodeMirror toggle + CopyButton; dedicated tool-call cards linked by
 * call-id; a `[Redacted thinking]` placeholder; a long-history "Show N more" collapse; and a raw-JSON
 * CodeMirror fallback when the payload is not a chat array.
 *
 * XSS invariant (D5 / R2 — the load-bearing rule): markdown is rendered ONLY through the single
 * `Markdown` wrapper below, which runs `rehype-sanitize` (default schema strips `<script>`, event
 * handlers, and `javascript:` URLs). This module is the ONLY `react-markdown` import site, and it never
 * uses `dangerouslySetInnerHTML`. Raw JSON stays in the CodeMirror `readOnly` view (document text, not
 * HTML) — the preserved M48 XSS guard.
 */

const REDACTED = '<REDACTED>';
// Above this many messages a history is collapsed to first + last N with a "Show N more" toggle so a
// 50-turn agent trace does not render 50 CodeMirror editors at once.
const COLLAPSE_THRESHOLD = 8;
const HEAD_TAIL = 3; // messages shown at each end when collapsed
// Byte guard: a markdown body larger than this is truncated with a "Show more" affordance so a
// pathological megabyte-string payload cannot lock the render.
const MAX_MARKDOWN_BYTES = 8000;

// ---- the single sanitized markdown wrapper (the ONLY react-markdown import site) ----

/**
 * Render `source` as sanitized markdown. `rehype-sanitize` (default schema) strips `<script>`, event
 * handlers, and `javascript:` URLs. Empty string → renders nothing; plain text → verbatim. Over the
 * byte guard the body truncates behind a "Show more" toggle (never silently dropped).
 */
export function Markdown({ source }: { source: string }) {
  const [expanded, setExpanded] = useState(false);
  if (source === '') return null;

  const oversized = source.length > MAX_MARKDOWN_BYTES;
  const shown = oversized && !expanded ? source.slice(0, MAX_MARKDOWN_BYTES) : source;

  return (
    <div className="space-y-1">
      <div className="prose prose-sm dark:prose-invert max-w-none break-words text-xs" data-testid="markdown-body">
        <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{shown}</ReactMarkdown>
      </div>
      {oversized ? (
        <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : `Show more (${source.length - MAX_MARKDOWN_BYTES} more chars)`}
        </Button>
      ) : null}
    </div>
  );
}

// ---- raw-JSON CodeMirror (preserved M48 XSS-safe view) ----

/** Read-only, syntax-highlighted, foldable JSON/text via CodeMirror. Values are document text, never HTML. */
function JsonView({ text, testId }: { text: string; testId?: string }) {
  return (
    <div data-testid={testId} className="overflow-hidden rounded-md border">
      <CodeMirror
        value={text}
        editable={false}
        basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
        extensions={[json(), EditorView.lineWrapping, EditorState.readOnly.of(true)]}
      />
    </div>
  );
}

// ---- message classification (pure, total) ----

/** True when a message's content is redacted OR is/contains redacted thinking/reasoning. */
function isRedactedThinking(m: ChatMessage): boolean {
  if (m.content === REDACTED) return true;
  // Anthropic-shaped content blocks: [{type:'thinking'|'redacted_thinking', thinking:'<REDACTED>'}].
  if (Array.isArray(m.content)) {
    return m.content.some((b) => {
      if (b === null || typeof b !== 'object') return false;
      const block = b as Record<string, unknown>;
      const type = typeof block.type === 'string' ? block.type : '';
      if (type === 'redacted_thinking') return true;
      if (type === 'thinking') {
        return block.thinking === REDACTED || block.thinking === undefined || block.thinking === '';
      }
      return false;
    });
  }
  return false;
}

/** Extract a plain-text markdown body from a message's content (strings, or joined text blocks). */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === 'string') return b;
        if (b !== null && typeof b === 'object') {
          const block = b as Record<string, unknown>;
          if (typeof block.text === 'string') return block.text;
          if (typeof block.thinking === 'string') return block.thinking;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }
  return JSON.stringify(content, null, 2);
}

// ---- role badge ----

/** Map a chat role to a Badge variant (system/user/assistant/tool — visual triage, not bubbles). */
function roleVariant(role: string): 'default' | 'primary' | 'accent' | 'outline' {
  switch (role) {
    case 'user':
      return 'primary';
    case 'assistant':
      return 'accent';
    case 'system':
      return 'default';
    default:
      return 'outline'; // tool + unknown
  }
}

// ---- cards ----

/** A bordered, role-labeled Card: role Badge + sanitized markdown body + raw-JSON toggle + CopyButton. */
function MessageCard({ message }: { message: ChatMessage }) {
  const [showRaw, setShowRaw] = useState(false);
  const raw = JSON.stringify(message, null, 2);
  const redacted = isRedactedThinking(message);
  const body = contentText(message.content);

  return (
    <Card size="sm" data-testid="io-card">
      <Card.Body className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant={roleVariant(message.role)} data-testid="io-role">
            {message.role}
          </Badge>
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={showRaw ? 'Hide raw JSON' : 'Show raw JSON'}
              onClick={() => setShowRaw((r) => !r)}
            >
              {showRaw ? 'Hide JSON' : 'Raw JSON'}
            </Button>
            <CopyButton value={raw} label="Copy message JSON" variant="ghost" size="sm" />
          </div>
        </div>
        {redacted ? (
          <p className="text-xs italic text-muted-foreground" data-testid="io-redacted-thinking">
            [Redacted thinking]
          </p>
        ) : body ? (
          <Markdown source={body} />
        ) : (
          <p className="text-xs text-muted-foreground">—</p>
        )}
        {showRaw ? <JsonView text={raw} testId="io-raw-json" /> : null}
      </Card.Body>
    </Card>
  );
}

/** A dedicated tool-call card: function name + call-id + JSON arguments. Linked to its result by id. */
function ToolCallCard({ call }: { call: ToolCall }) {
  const name = call.function?.name ?? '(unnamed tool)';
  const args = call.function?.arguments ?? '';
  return (
    <Card size="sm" data-testid={`tool-call-${call.id}`}>
      <Card.Body className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">tool call</Badge>
          <span className="font-mono text-xs font-semibold">{name}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{call.id}</span>
          <div className="ml-auto">
            <CopyButton value={args} label="Copy tool arguments" variant="ghost" size="sm" />
          </div>
        </div>
        {args ? <JsonView text={prettyValue(args)} testId={`tool-call-args-${call.id}`} /> : null}
      </Card.Body>
    </Card>
  );
}

/** A tool-result card, linked to its originating call by `tool_call_id`. */
function ToolResultCard({ message }: { message: ChatMessage }) {
  const id = message.tool_call_id ?? '';
  const text = contentText(message.content);
  return (
    <Card size="sm" data-testid={`tool-result-${id}`}>
      <Card.Body className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">tool result</Badge>
          <span className="font-mono text-[10px] text-muted-foreground">↳ {id}</span>
          <div className="ml-auto">
            <CopyButton value={text} label="Copy tool result" variant="ghost" size="sm" />
          </div>
        </div>
        <JsonView text={prettyValue(text)} testId={`tool-result-body-${id}`} />
      </Card.Body>
    </Card>
  );
}

/** Render one chat message as its appropriate card kind (tool-call → result → plain message). */
function MessageItem({ message }: { message: ChatMessage }) {
  // A `tool` role (with a `tool_call_id`) is a result linked back to its call.
  if (message.role === 'tool' && message.tool_call_id) {
    return <ToolResultCard message={message} />;
  }
  // An assistant message may carry one or more tool calls; render the message body (if any) plus a
  // dedicated card per call so a result can link to it by id.
  const calls = message.tool_calls ?? [];
  if (calls.length > 0) {
    const hasBody = contentText(message.content) !== '' || isRedactedThinking(message);
    return (
      <div className="space-y-2">
        {hasBody ? <MessageCard message={message} /> : null}
        {calls.map((c) => (
          <ToolCallCard key={c.id} call={c} />
        ))}
      </div>
    );
  }
  return <MessageCard message={message} />;
}

// ---- history collapse ----

/** Render a message list, collapsing long histories to first + last N behind a "Show N more" toggle. */
function MessageFeed({ messages }: { messages: ChatMessage[] }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = messages.length > COLLAPSE_THRESHOLD;

  if (!collapsible || expanded) {
    return (
      <div className="space-y-2" data-testid="io-feed">
        {messages.map((m, i) => (
          <MessageItem key={i} message={m} />
        ))}
        {collapsible && expanded ? (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
            Show less
          </Button>
        ) : null}
      </div>
    );
  }

  const head = messages.slice(0, HEAD_TAIL);
  const tail = messages.slice(messages.length - HEAD_TAIL);
  const hiddenCount = messages.length - head.length - tail.length;

  return (
    <div className="space-y-2" data-testid="io-feed">
      {head.map((m, i) => (
        <MessageItem key={`h-${i}`} message={m} />
      ))}
      <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
        {`Show ${hiddenCount} more`}
      </Button>
      {tail.map((m, i) => (
        <MessageItem key={`t-${i}`} message={m} />
      ))}
    </div>
  );
}

// ---- public entry ----

/**
 * Render a span input/output value. Redacted markers and non-chat payloads fall back to text/JSON; a
 * chat-message array renders as role-labeled cards (with tool-call linkage and long-history collapse).
 * This replaces the old `ValueBlock` triage — same fallbacks, richer chat rendering.
 */
export function IoCards({ value, testId }: { value?: string; testId?: string }) {
  if (value === undefined || value === null || value === '') {
    return <p className="text-xs text-muted-foreground">—</p>;
  }
  if (value === REDACTED) {
    return (
      <p className="text-xs text-muted-foreground" data-testid={testId}>
        Redacted by the client (prompt logging is off).
      </p>
    );
  }
  const chat = asChat(value);
  if (chat) {
    return (
      <div data-testid={testId}>
        <MessageFeed messages={chat} />
      </div>
    );
  }
  // Non-chat payload → the raw-JSON CodeMirror fallback (preserved behavior + XSS guard).
  return <JsonView text={prettyValue(value)} testId={testId} />;
}
