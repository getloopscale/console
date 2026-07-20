import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { Card, IOCards } from '@usetheo/ui';

import { cloudFetch } from '@/lib/api';
import { shortId } from '@/lib/format';
import type { TraceSpanNode } from '@/lib/trace-layout';
import { Markdown } from '../trace-detail/markdown';
import { sortSessionTracesByStart, toConversationTurns, type SessionTraceRef } from './to-conversation-turns';

/**
 * M132 — the Session Conversation replay. Renders the session turn-by-turn: per trace a Human
 * (input) card → an AI (output) card, full text, reusing `@usetheo/ui` `IOCards` (chat-array → role
 * cards, JSON → JsonViewer, text → message; Pretty/Raw + long-history collapse) + the lens Markdown
 * sanitizer. Full I/O is fetched lazily per trace via the SAME `GET /v1/dashboard/lens/traces/{id}`
 * tree read the trace-detail uses (shared React-Query cache), turned into ordered turns by the pure
 * `toConversationTurns` mapper. Mounts only when the Conversation tab is active (lazy fan-out), capped.
 */

/** ADR-3 — cap the eager per-trace fetches; beyond it, link to the full traces list. */
export const CONVERSATION_TURN_CAP = 50;

const renderMarkdown = (text: string) => <Markdown source={text} />;

export function SessionConversation({ sessionId, traces }: { sessionId: string; traces: SessionTraceRef[] }) {
  // HIGH (review) — sort into conversation order BEFORE capping: the session read is newest-first, so
  // capping the raw order would keep the LATEST turns and drop the conversation's true start.
  const ordered = sortSessionTracesByStart(traces);
  const capped = ordered.slice(0, CONVERSATION_TURN_CAP);
  const overflow = ordered.length - capped.length;

  // One lazy fetch per capped trace. The queryKey MATCHES trace-detail's tree fetch, so opening a trace
  // and the conversation share the cache (no double fetch). cloudFetch returns null on error (no throw).
  const results = useQueries({
    queries: capped.map((t) => ({
      queryKey: ['cloud', '/v1/dashboard/lens/traces', t.traceId, 'tree'] as const,
      queryFn: () => cloudFetch<TraceSpanNode>(`/v1/dashboard/lens/traces/${encodeURIComponent(t.traceId)}`),
    })),
  });

  // Only SETTLED traces enter the map; a still-pending trace is absent → its turn shows "Loading turn…".
  const treeByTraceId = new Map<string, TraceSpanNode | null>();
  capped.forEach((t, i) => {
    const r = results[i];
    if (r && !r.isPending) treeByTraceId.set(t.traceId, r.data ?? null);
  });
  const turns = toConversationTurns(capped, treeByTraceId);

  return (
    <div className="space-y-4" data-testid="session-conversation">
      {turns.map((turn) => {
        const pending = !treeByTraceId.has(turn.traceId);
        return (
          <Card key={turn.traceId} data-testid="conversation-turn">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Turn {turn.index}</span>
              {turn.name ? <span className="truncate">· {turn.name}</span> : null}
              <span className="font-mono">{shortId(turn.traceId)}</span>
            </div>
            {pending ? (
              <p className="text-xs text-muted-foreground">Loading turn…</p>
            ) : turn.loadFailed ? (
              <p className="text-xs text-destructive" role="alert">(could not load this turn)</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Human</div>
                  {turn.input != null ? (
                    <IOCards value={turn.input} renderMarkdown={renderMarkdown} data-testid="turn-input" />
                  ) : (
                    <p className="text-xs text-muted-foreground">(no input)</p>
                  )}
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">AI</div>
                  {turn.output != null ? (
                    <IOCards value={turn.output} renderMarkdown={renderMarkdown} data-testid="turn-output" />
                  ) : (
                    <p className="text-xs text-muted-foreground">(no output)</p>
                  )}
                </div>
              </div>
            )}
          </Card>
        );
      })}
      {overflow > 0 ? (
        <Link
          to={`/observability/traces?session=${encodeURIComponent(sessionId)}`}
          className="text-sm font-medium text-primary underline underline-offset-4"
        >
          View all {traces.length} traces →
        </Link>
      ) : null}
    </div>
  );
}
