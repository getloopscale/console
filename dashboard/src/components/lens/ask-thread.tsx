import { type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, StatusDot, Textarea } from '@usetheo/ui';

import { cloudFetch } from '@/lib/api';
import { shortId } from '@/lib/format';
import { Markdown } from '@/pages/lens/trace-detail/io-cards';
import type { TraceSpanNode } from '@/lib/trace-layout';
import { STARTER_PROMPTS, buildEntityMap, resolveCitations, type Turn } from './ask-thread-model';

/**
 * M61 — the Ask copilot as a persistent, client-side conversation thread docked to the open trace
 * (Opik `TraceAIViewer` model; blueprint §6). The M33 ask endpoint is single-turn + stateless (ADR D1),
 * so the thread lives in React and stacks independent asks; it is **keyed by `traceId`** and cleared when
 * the docked trace changes so one trace's conversation never bleeds into another (ADR D2 / R1). Assistant
 * answers render through the reused XSS-safe `Markdown` wrapper (ADR D3 / R2) with `[span:<id>]` markers
 * resolved to linked span names via the entity map (ADR D4 / R3 — unknown ids stay plain text). Each
 * submit is ONE M33 ask with `retry:false` (no billable retry loop); 502/503/429/404 fail closed to a
 * typed `Alert`, never a fabricated answer (R4).
 */

let idSeq = 0;
const nextId = () => `turn-${++idSeq}`;

/** Map the M33 fail-closed HTTP status to an honest, typed message. Reads `.status` off the `ApiError`
 *  (duck-typed — robust across module boundaries; `cloudFetch({throwOnError})` rejects with an ApiError). */
export function errorMessage(err: unknown): string {
  const status = (err as { status?: number } | null)?.status ?? 0;
  switch (status) {
    case 503:
      return 'The copilot provider is not configured right now.';
    case 502:
      return 'The copilot provider failed to answer — try again shortly.';
    case 429:
      return 'Rate limit reached for this workspace — wait a moment before asking again.';
    case 404:
      return 'This trace is not available (it may belong to another workspace).';
    default:
      return 'Could not answer — try again shortly.';
  }
}

/** Render an assistant answer: markdown text segments + inline span-citation badges (never raw HTML). */
function AnswerBody({ content, entityMap }: { content: string; entityMap: Map<string, string> }) {
  const segments = resolveCitations(content, entityMap);
  return (
    <div className="text-sm">
      {segments.map((seg, i) =>
        seg.kind === 'text' ? (
          <Markdown key={i} source={seg.text} />
        ) : (
          <Badge key={i} variant="outline" className="mx-0.5 align-baseline" data-testid="span-citation">
            {seg.name}
          </Badge>
        ),
      )}
    </div>
  );
}

export function AskThread({
  traceId,
  spans,
  initialSpanId,
}: {
  traceId: string;
  spans?: TraceSpanNode;
  initialSpanId?: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');

  const entityMap = useMemo(() => (spans ? buildEntityMap(spans) : new Map<string, string>()), [spans]);

  const ask = useMutation({
    // The ask carries the trace id it was invoked for (`askedTraceId`) so a resolving answer can be
    // matched to the still-docked trace — never landing under a different trace opened mid-flight (R1).
    mutationFn: (vars: { question: string; spanId?: string; askedTraceId: string }) =>
      cloudFetch<{ answer: string }>(
        `/v1/dashboard/lens/traces/${encodeURIComponent(vars.askedTraceId)}/ask`,
        {
          method: 'POST',
          body: JSON.stringify({ question: vars.question, ...(vars.spanId ? { spanId: vars.spanId } : {}) }),
        },
        { throwOnError: true },
      ),
    retry: false, // ADR D1 / R4 — a billable provider call is NEVER auto-retried.
    onSuccess: (data, vars) => {
      if (vars.askedTraceId !== traceId) return; // R1 — the docked trace changed mid-flight; drop the stale answer.
      const answer = (data?.answer ?? '').trim();
      if (answer === '') return; // never append an empty assistant turn.
      setTurns((t) => [...t, { id: nextId(), role: 'assistant', content: answer, spanId: vars.spanId }]);
    },
  });

  // ADR D2 / R1 — a fresh thread per trace: clear turns/draft AND reset any in-flight/stale ask when the
  // docked trace changes, so trace A's conversation (or an in-flight A answer) never bleeds into trace B.
  useEffect(() => {
    setTurns([]);
    setDraft('');
    ask.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key on traceId only; ask.reset is stable.
  }, [traceId]);

  const submit = () => {
    const q = draft.trim();
    if (!q || ask.isPending) return;
    setTurns((t) => [...t, { id: nextId(), role: 'user', content: q, spanId: initialSpanId }]);
    ask.mutate({ question: q, spanId: initialSpanId, askedTraceId: traceId });
    setDraft('');
  };

  const toggleFeedback = (id: string, fb: 'up' | 'down') =>
    setTurns((t) => t.map((x) => (x.id === id ? { ...x, feedback: x.feedback === fb ? undefined : fb } : x)));

  return (
    <div className="space-y-4">
      {turns.length === 0 && !ask.isPending ? (
        <div data-testid="ask-empty" className="space-y-3">
          <EmptyState
            title="Ask the copilot about this trace"
            description="Grounded in the open trace — nothing to type but your question."
          />
          <div className="flex flex-col gap-2">
            {STARTER_PROMPTS.map((p) => (
              <Button key={p} variant="secondary" size="sm" className="justify-start" onClick={() => setDraft(p)}>
                {p}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {turns.map((turn) => (
          <Card key={turn.id} data-testid={`thread-turn-${turn.role}`}>
            <Card.Body className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant={turn.role === 'user' ? 'outline' : 'default'}>{turn.role}</Badge>
                {turn.spanId ? (
                  <Badge variant="outline" className="text-xs">
                    re: {entityMap.get(turn.spanId) ?? shortId(turn.spanId)}
                  </Badge>
                ) : null}
              </div>
              {turn.role === 'assistant' ? (
                <>
                  <AnswerBody content={turn.content} entityMap={entityMap} />
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-pressed={turn.feedback === 'up'}
                      aria-label="Helpful"
                      onClick={() => toggleFeedback(turn.id, 'up')}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-pressed={turn.feedback === 'down'}
                      aria-label="Not helpful"
                      onClick={() => toggleFeedback(turn.id, 'down')}
                    >
                      <ThumbsDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{turn.content}</p>
              )}
            </Card.Body>
          </Card>
        ))}

        {ask.isPending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <StatusDot status="live" size="xs" /> Thinking…
          </div>
        ) : null}

        {ask.isError ? (
          <Alert intent="warning" title="Could not answer">
            {errorMessage(ask.error)}
          </Alert>
        ) : null}
      </div>

      <div className="flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask a question about this trace… (⌘↵ to send)"
          aria-label="Question"
        />
        <Button onClick={submit} disabled={!draft.trim() || ask.isPending}>
          {ask.isPending ? 'Asking…' : 'Ask'}
        </Button>
      </div>
    </div>
  );
}
