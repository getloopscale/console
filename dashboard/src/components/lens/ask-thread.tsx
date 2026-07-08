import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ThumbsUp, ThumbsDown } from 'lucide-react';

import { Badge, Button, Card, EmptyState, StatusDot, Textarea } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

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

/** Render an assistant answer: markdown text segments + inline span-citation badges (never raw HTML).
 *  M80 — a span citation is a Link to its span in the trace peek: `?trace=` opens the peek (M76) and
 *  `?spanId=` selects + scrolls to the cited span (a stale id falls back to the root — never crashes).
 *  `resolveCitations` only emits a citation for a span present in the trace, so the link never dangles. */
function AnswerBody({ content, entityMap, traceId }: { content: string; entityMap: Map<string, string>; traceId: string }) {
  const segments = resolveCitations(content, entityMap);
  return (
    <div className="text-sm">
      {segments.map((seg, i) =>
        seg.kind === 'text' ? (
          <Markdown key={`t-${i}`} source={seg.text} />
        ) : (
          <Link
            key={`s-${seg.spanId}-${i}`}
            to={`/observability/traces?trace=${encodeURIComponent(traceId)}&spanId=${encodeURIComponent(seg.spanId)}`}
            aria-label={`Open span ${seg.name} in the trace`}
            className="mx-0.5 align-baseline"
          >
            <Badge variant="outline" className="cursor-pointer hover:bg-muted" data-testid="span-citation">
              {seg.name}
            </Badge>
          </Link>
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
  const bottomRef = useRef<HTMLDivElement>(null);

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

  // M83 — record thumbs feedback on ONE answer. The feedback is keyed by the client-side turn id
  // (the M33 ask is stateless, so the thread's turn ordinal is the stable per-answer key). Optimistic:
  // the pressed state shows immediately; a failed POST fails closed to a typed error AND reverts the
  // local state (no fabricated success, R4). Independent of the LLM provider (risk-2) — a 502 on the
  // ask never blocks feedback, and vice-versa.
  const feedback = useMutation({
    mutationFn: (vars: { turnId: string; label: 'up' | 'down'; spanId?: string }) =>
      cloudFetch<{ label: string }>(
        `/v1/dashboard/lens/traces/${encodeURIComponent(traceId)}/ask/feedback`,
        { method: 'POST', body: JSON.stringify({ turnId: vars.turnId, label: vars.label, ...(vars.spanId ? { spanId: vars.spanId } : {}) }) },
        { throwOnError: true },
      ),
    retry: false,
    onError: (_e, vars) => {
      // revert the optimistic toggle for this turn (honest — the vote did not persist).
      setTurns((t) => t.map((x) => (x.id === vars.turnId ? { ...x, feedback: undefined } : x)));
    },
  });

  // M83 — retract a vote (the UI "clear"). Persists via DELETE so the store never diverges from the
  // shown thumb (review H-1). Optimistic; a failed DELETE reverts to the prior label + typed error.
  const clearFeedback = useMutation({
    mutationFn: (vars: { turnId: string }) =>
      cloudFetch<void>(
        `/v1/dashboard/lens/traces/${encodeURIComponent(traceId)}/ask/feedback?turnId=${encodeURIComponent(vars.turnId)}`,
        { method: 'DELETE' },
        { throwOnError: true },
      ),
    retry: false,
  });

  const vote = (turn: Turn, label: 'up' | 'down') => {
    const prev = turn.feedback;
    const next = prev === label ? undefined : label; // click the active thumb again → clear
    setTurns((t) => t.map((x) => (x.id === turn.id ? { ...x, feedback: next } : x)));
    if (next !== undefined) {
      feedback.mutate({ turnId: turn.id, label: next, ...(turn.spanId ? { spanId: turn.spanId } : {}) });
    } else {
      // clear → DELETE; revert to the prior label on failure (no silent UI/DB divergence).
      clearFeedback.mutate(
        { turnId: turn.id },
        { onError: () => setTurns((t) => t.map((x) => (x.id === turn.id ? { ...x, feedback: prev } : x))) },
      );
    }
  };

  // ADR D2 / R1 — a fresh thread per trace: clear turns/draft AND reset any in-flight/stale ask when the
  // docked trace changes, so trace A's conversation (or an in-flight A answer) never bleeds into trace B.
  useEffect(() => {
    setTurns([]);
    setDraft('');
    ask.reset();
    feedback.reset();
    clearFeedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key on traceId only; reset fns are stable.
  }, [traceId]);

  // M72 — auto-scroll to the latest turn (or the thinking indicator) so a new answer is in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
  }, [turns.length, ask.isPending]);

  const submit = () => {
    const q = draft.trim();
    if (!q || ask.isPending) return;
    setTurns((t) => [...t, { id: nextId(), role: 'user', content: q, spanId: initialSpanId }]);
    ask.mutate({ question: q, spanId: initialSpanId, askedTraceId: traceId });
    setDraft('');
  };

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

      {/* M71 — the conversation is a log live-region so a screen reader announces new answers as they
          stream in (polite: it waits for the reader to finish the current utterance). */}
      <div className="space-y-3" role="log" aria-live="polite" aria-label="Copilot conversation">
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
                  <AnswerBody content={turn.content} entityMap={entityMap} traceId={traceId} />
                  {/* M83 — thumbs feedback restored, now wired to the persist endpoint (#181). The
                      pressed thumb reflects the recorded vote; clicking the active thumb clears it. */}
                  <div className="flex items-center gap-1 pt-1" data-testid="answer-feedback">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Good answer"
                      aria-pressed={turn.feedback === 'up'}
                      onClick={() => vote(turn, 'up')}
                    >
                      <ThumbsUp className={`h-4 w-4 ${turn.feedback === 'up' ? 'text-primary' : 'text-muted-foreground'}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Bad answer"
                      aria-pressed={turn.feedback === 'down'}
                      onClick={() => vote(turn, 'down')}
                    >
                      <ThumbsDown className={`h-4 w-4 ${turn.feedback === 'down' ? 'text-destructive' : 'text-muted-foreground'}`} />
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
          <Alert intent="warning" title="Could not answer" description={errorMessage(ask.error)} />
        ) : null}
        {feedback.isError || clearFeedback.isError ? (
          <Alert intent="warning" title="Feedback not saved" description="Could not save your feedback — try again shortly." data-testid="feedback-error" />
        ) : null}
        <div ref={bottomRef} aria-hidden="true" />
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
