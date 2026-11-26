import { useEffect, useRef, useState, type ReactNode } from 'react';
import { traceTreeQueryKey, fetchTrace } from '@/hooks/lens/use-trace';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { IOCards } from '@getloopscale/ui';

import { shortId } from '@/lib/formatting/format';
import type { TraceSpanNode } from '@/hooks/lens/trace-layout';
import { Markdown } from '@/pages/lens/components/markdown';
import { sortSessionTracesByStart, toConversationTurns, type SessionTraceRef } from './to-conversation-turns';

/**
 * M132 — the Session Conversation replay. Renders the session as a CHAT: per trace a Human (input)
 * bubble on the left → an AI (output) bubble offset to the right, mirroring Arize AX's "Session
 * Conversation". Full I/O is fetched lazily per trace via the SAME `GET /v1/dashboard/lens/traces/{id}`
 * tree read the trace-detail uses (shared React-Query cache), ordered by the pure `toConversationTurns`
 * mapper, and rendered with `@getloopscale/ui` `IOCards` (chat→role cards / JSON→JsonViewer / text→message).
 *
 * The conversation flows in normal document order inside the app shell's single scroll container
 * (see DashboardLayout — <main> is the scroller), so the mouse wheel scrolls it like every other page.
 * A subtle bordered surface frames it as a chat; each bubble caps its height with a "Show more" toggle
 * so a long tool-output never becomes an unnavigable wall.
 */

/** ADR-3 — cap the eager per-trace fetches; beyond it, link to the full traces list. */
export const CONVERSATION_TURN_CAP = 50;

/**
 * B-056 — quantos turnos a conversa busca de uma vez.
 *
 * ## O defeito
 *
 * O componente disparava um GET de arvore por turno, ate 50, todos no mount.
 * Cinquenta requests paralelos e cinquenta resolucoes de tenant no BFF para
 * pintar uma tela que a pessoa le de cima para baixo — e que na maioria das
 * sessoes ela abandona no quinto turno. O trabalho dos turnos 11 a 50 e feito
 * para ser jogado fora, e e o pico de concorrencia que atrasa o primeiro turno,
 * justamente o unico que alguem sempre le.
 *
 * ## Por que nao o endpoint em lote
 *
 * O DoD do item pedia um read em lote no BFF (`?ids=a,b,c`). Fica registrado
 * como adiado, e a razao e medida, nao preferencia: `internal/routes/
 * lens_dashboard.go:370` proxia `GetTrace(ctx, id)` um a um para o looptrace, e
 * o looptrace nao expoe leitura em lote. Um `?ids=` no BFF trocaria 50 requests
 * do browser por 1 — ganho real em conexoes e em resolucao de tenant — mas
 * manteria os 50 upstream e continuaria BAIXANDO as 50 arvores, inclusive as que
 * ninguem le. Corrige a contagem, nao o volume.
 *
 * Buscar sob demanda corrige os dois eixos e nao depende de mudanca em outro
 * dominio. Quando o lote existir, os dois se somam em vez de competir.
 *
 * ## O numero
 *
 * 10 e escolha: cobre a conversa inicial inteira na maioria das sessoes sem
 * pedir nada que va para o lixo. Se a medicao mostrar que a maioria clica em
 * "show more" na primeira interacao, o numero sobe; o que nao volta e o pico de
 * 50 no mount.
 */
export const CONVERSATION_TURNS_PER_PAGE = 10;

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

  // B-056 — so os turnos pedidos sao buscados. `useQueries` sobre a janela, nao
  // sobre `capped`: um `enabled: false` ainda ocuparia um slot de query e faria
  // o hook crescer com a colecao, que e exatamente o que o item mede.
  const [shown, setShown] = useState(CONVERSATION_TURNS_PER_PAGE);
  const window = capped.slice(0, shown);
  const restantes = capped.length - window.length;

  const results = useQueries({
    queries: window.map((t) => ({
      queryKey: traceTreeQueryKey(t.traceId),
      // throwOnError: false DELIBERADO — um turno que falha mostra
      // "(could not load this turn)" e os outros renderizam. Ver use-trace.ts.
      queryFn: () => fetchTrace(t.traceId, { throwOnError: false }),
    })),
  });

  const treeByTraceId = new Map<string, TraceSpanNode | null>();
  window.forEach((t, i) => {
    const r = results[i];
    if (r && !r.isPending) treeByTraceId.set(t.traceId, r.data ?? null);
  });
  const turns = toConversationTurns(window, treeByTraceId);

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
      {restantes > 0 ? (
        <button
          type="button"
          onClick={() => setShown((n) => n + CONVERSATION_TURNS_PER_PAGE)}
          className="block text-sm font-medium text-primary underline underline-offset-4"
          data-testid="load-more-turns"
        >
          Show {Math.min(restantes, CONVERSATION_TURNS_PER_PAGE)} more turn
          {Math.min(restantes, CONVERSATION_TURNS_PER_PAGE) === 1 ? '' : 's'} ({restantes} remaining)
        </button>
      ) : null}
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
