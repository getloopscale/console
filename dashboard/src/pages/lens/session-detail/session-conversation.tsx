import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { IOCards } from '@usetheo/ui';

import { cloudFetch } from '@/lib/http/api';
import { shortId } from '@/lib/formatting/format';
import type { TraceSpanNode } from '@/components/lens/trace-layout';
import { Markdown } from '@/components/common/markdown';
import { sortSessionTracesByStart, toConversationTurns, type SessionTraceRef } from './to-conversation-turns';

/**
 * M132 — the Session Conversation replay. Renders the session as a CHAT: per trace a Human (input)
 * bubble on the left → an AI (output) bubble offset to the right, mirroring Arize AX's "Session
 * Conversation". Full I/O is fetched lazily per trace via the SAME `GET /v1/dashboard/lens/traces/{id}`
 * tree read the trace-detail uses (shared React-Query cache), ordered by the pure `toConversationTurns`
 * mapper, and rendered with `@usetheo/ui` `IOCards` (chat→role cards / JSON→JsonViewer / text→message).
 *
 * The conversation flows in normal document order inside the app shell's single scroll container
 * (see DashboardLayout — <main> is the scroller), so the mouse wheel scrolls it like every other page.
 * A subtle bordered surface frames it as a chat; each bubble caps its height with a "Show more" toggle
 * so a long tool-output never becomes an unnavigable wall.
 */

/** ADR-3 — cap the eager per-trace fetches; beyond it, link to the full traces list. */
export const CONVERSATION_TURN_CAP = 50;

const renderMarkdown = (text: string) => <Markdown source={text} />;

/** A turn body capped to a readable height with a "Show more/less" toggle when it overflows. */
function CappedBody({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 4);
  }, [children]);
  return (
    <div>
      <div
        ref={ref}
        className={expanded ? 'overflow-auto' : 'max-h-64 overflow-hidden'}
        data-testid="turn-body"
      >
        {children}
      </div>
      {overflows || expanded ? (
        <button
          type="button"
          className="mt-1 text-xs font-medium text-primary hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}

/** A single Human or AI chat bubble. Human is left-aligned; AI is offset to the right (chat feel). */
function Bubble({ role, children }: { role: 'human' | 'ai'; children: ReactNode }) {
  const isAI = role === 'ai';
  return (
    <div className={isAI ? 'flex flex-col items-end' : 'flex flex-col items-start'}>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className={`h-1.5 w-1.5 rounded-full ${isAI ? 'bg-primary' : 'bg-muted-foreground'}`} />
        {isAI ? 'AI' : 'Human'}
      </div>
      <div
        className={`w-full max-w-[92%] rounded-lg border p-3 ${
          isAI ? 'border-primary/20 bg-primary/5' : 'border-border bg-muted/30'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function SessionConversation({ sessionId, traces }: { sessionId: string; traces: SessionTraceRef[] }) {
  // HIGH (review) — sort into conversation order BEFORE capping (the session read is newest-first).
  const ordered = sortSessionTracesByStart(traces);
  const capped = ordered.slice(0, CONVERSATION_TURN_CAP);
  const overflow = ordered.length - capped.length;

  const results = useQueries({
    queries: capped.map((t) => ({
      queryKey: ['cloud', '/v1/dashboard/lens/traces', t.traceId, 'tree'] as const,
      queryFn: () => cloudFetch<TraceSpanNode>(`/v1/dashboard/lens/traces/${encodeURIComponent(t.traceId)}`),
    })),
  });

  const treeByTraceId = new Map<string, TraceSpanNode | null>();
  capped.forEach((t, i) => {
    const r = results[i];
    if (r && !r.isPending) treeByTraceId.set(t.traceId, r.data ?? null);
  });
  const turns = toConversationTurns(capped, treeByTraceId);

  return (
    // Flows in the app shell's single scroll container (DashboardLayout <main>) — no nested scroll region.
    // A subtle bordered surface frames the turns as a chat conversation.
    <div
      className="space-y-6 rounded-lg border border-border/60 bg-background/40 p-4"
      data-testid="session-conversation"
    >
      {turns.map((turn) => {
        const pending = !treeByTraceId.has(turn.traceId);
        return (
          <div key={turn.traceId} className="space-y-2 border-b border-border/40 pb-5 last:border-0" data-testid="conversation-turn">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">Turn {turn.index}</span>
              {turn.name ? <span className="truncate">{turn.name}</span> : null}
              <Link
                to={`/observability/traces?trace=${encodeURIComponent(turn.traceId)}`}
                className="font-mono text-primary hover:underline"
              >
                {shortId(turn.traceId)}
              </Link>
            </div>
            {pending ? (
              <p className="text-xs text-muted-foreground">Loading turn…</p>
            ) : turn.loadFailed ? (
              <p className="text-xs text-destructive" role="alert">(could not load this turn)</p>
            ) : (
              <div className="space-y-3">
                <Bubble role="human">
                  {turn.input != null ? (
                    <CappedBody>
                      <IOCards value={turn.input} renderMarkdown={renderMarkdown} data-testid="turn-input" />
                    </CappedBody>
                  ) : (
                    <p className="text-xs text-muted-foreground">(no input)</p>
                  )}
                </Bubble>
                <Bubble role="ai">
                  {turn.output != null ? (
                    <CappedBody>
                      <IOCards value={turn.output} renderMarkdown={renderMarkdown} data-testid="turn-output" />
                    </CappedBody>
                  ) : (
                    <p className="text-xs text-muted-foreground">(no output)</p>
                  )}
                </Bubble>
              </div>
            )}
          </div>
        );
      })}
      {overflow > 0 ? (
        <Link
          to={`/observability/traces?session=${encodeURIComponent(sessionId)}`}
          className="block text-sm font-medium text-primary underline underline-offset-4"
        >
          View all {traces.length} traces →
        </Link>
      ) : null}
    </div>
  );
}
