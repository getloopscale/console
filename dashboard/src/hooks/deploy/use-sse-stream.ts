import { useEffect, useRef, useState } from 'react';
import { API_URL } from '@/lib/http/config';
import { ensureSSEToken, clearToken } from '@/lib/http/api';
import { SharedEventSource } from '@/hooks/deploy/shared-event-source';
import type { StreamEndReason } from './stream-end-reason';

/**
 * useSSEStream — generic typed SSE consumer (Plan J-17 T2.1).
 *
 * Wraps an EventSource lifecycle behind a typed event array. Each named
 * event type the caller registers in `eventTypes` is bound via
 * `addEventListener(type, handler)` so the server's `event: <type>`
 * lines flow into the same buffer.
 *
 * Features:
 * - Last-Event-ID resume on reconnect (EC-9) — the browser handles this
 *   natively. We also expose `lastEventID` for callers that want to seed
 *   the URL after a token refresh.
 * - Token refresh on persistent 401 (EC-3) — when 3 consecutive errors
 *   land without a successful open, we call `clearToken()` + the next
 *   `ensureSSEToken()` exchanges a fresh JWT.
 * - maxEvents FIFO cap (EC-10) — buffer cannot grow unbounded if the
 *   user leaves the tab in the background.
 * - `paused` lets the consumer freeze updates without disconnecting.
 *
 * Auth: SSE cannot set custom headers, so the JWT travels in `?token=`.
 * That matches the BFF pattern in use-log-stream (T6.0 of the older
 * backend-frontend integration plan).
 */
export interface SSEStreamEvent<T = unknown> {
  id: string;
  type: string;
  data: T;
}

export interface UseSSEStreamOptions<T = unknown> {
  /**
   * Names of SSE events to listen for. The default `message` listener
   * is also bound so servers using `data:` lines without an explicit
   * `event:` still deliver. Each event the listener receives is
   * pushed into the buffer with its `type`.
   */
  eventTypes?: string[];
  /** Buffer cap; oldest events dropped FIFO when exceeded. */
  maxEvents?: number;
  /** Freeze updates without closing the connection. */
  paused?: boolean;
  /** Side-effect callback on each event. Buffer state still updates. */
  onEvent?: (event: SSEStreamEvent<T>) => void;
  /**
   * Seed the initial Last-Event-ID (used after a REST snapshot so the
   * stream resumes from where the snapshot ended — EC-5).
   */
  initialLastEventID?: string | null;
}

export interface UseSSEStreamResult<T = unknown> {
  events: SSEStreamEvent<T>[];
  connected: boolean;
  error: boolean;
  lastEventID: string | null;
  /** Total events dropped by the FIFO maxEvents cap since the last clear(). */
  droppedCount: number;
  clear: () => void;
}

// 3 erros consecutivos sem um open => assume token expirado.
//
// Este limiar so vale para o caminho de RECONEXAO NATIVA do browser, em que o
// EventSource fica em CONNECTING e tenta sozinho. Ver B-014 abaixo: quando o
// browser FECHA a conexao (readyState CLOSED), esperar tres erros e esperar por
// algo que nunca vem.
const TOKEN_REFRESH_THRESHOLD = 3;

/** Teto do backoff exponencial da reabertura manual. */
const MAX_REOPEN_DELAY_MS = 30_000;

/**
 * `EventSource.CLOSED`. Declarado como literal em vez de lido da estatica porque
 * nem todo ambiente a expoe — jsdom e mocks de teste frequentemente implementam
 * `readyState` sem as constantes de classe, e a comparacao viraria
 * `2 === undefined`, ou seja, silenciosamente falsa. O valor e fixado pela spec.
 */

export function useSSEStream<T = unknown>(
  path: string | null,
  options: UseSSEStreamOptions<T> = {},
): UseSSEStreamResult<T> {
  const {
    eventTypes = [],
    maxEvents = 1000,
    paused = false,
    onEvent,
    initialLastEventID = null,
  } = options;

  const [events, setEvents] = useState<SSEStreamEvent<T>[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(false);
  const [lastEventID, setLastEventID] = useState<string | null>(initialLastEventID);
  const [droppedCount, setDroppedCount] = useState(0);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const bufferRef = useRef<SSEStreamEvent<T>[]>([]);
  const droppedRef = useRef(0);
  const lastIDRef = useRef<string | null>(initialLastEventID);

  // Stable join key for the eventTypes dep (re-binding on real change).
  const eventTypesKey = eventTypes.join('|');

  useEffect(() => {
    if (!path) {
      return;
    }
    setEvents([]);
    droppedRef.current = 0;
    setDroppedCount(0);
    setError(false);
    setConnected(false);
    bufferRef.current = [];

    let cancelled = false;
    let es: EventSource | null = null;
    let failureCount = 0;
    let reopenAttempts = 0;
    let reopenTimer: ReturnType<typeof setTimeout> | null = null;

    const push = (id: string, type: string, raw: string) => {
      let data: T;
      try {
        data = JSON.parse(raw) as T;
      } catch {
        // Caller asked for typed events but server sent garbage; surface
        // the raw string under a known shape.
        data = raw as unknown as T;
      }
      const event: SSEStreamEvent<T> = { id, type, data };
      bufferRef.current.push(event);
      if (bufferRef.current.length > maxEvents) {
        const overflow = bufferRef.current.length - maxEvents;
        bufferRef.current.splice(0, overflow);
        droppedRef.current += overflow;
      }
      if (id) {
        lastIDRef.current = id;
      }
      if (!pausedRef.current) {
        setEvents([...bufferRef.current]);
        setLastEventID(lastIDRef.current);
        setDroppedCount(droppedRef.current);
      }
      onEventRef.current?.(event);
    };

    const open = async () => {
      const token = await ensureSSEToken();
      if (cancelled) return;
      if (!token) {
        setError(true);
        return;
      }
      // B-088 — a URL nao carrega mais credencial nem cursor de retomada.
      //
      // Ate 2026-08-07 esta linha montava `?token=${jwt}`, e o jwt era o bearer
      // COMPLETO da sessao — o mesmo da API, sem TTL proprio nem escopo de
      // stream. Um JWT em query string chega a access log do nginx (versionado
      // neste repo), log do proxy, historico do navegador e header Referer.
      //
      // O `last_event_id` estava na URL pelo mesmo motivo: `EventSource` nao
      // aceita header. Os dois voltaram para onde pertencem porque o transporte
      // deixou de ser `EventSource` — ver `fetch-event-source.ts` e o ADR-0009.
      const url = `${API_URL}${path}`;

      // B-020 — multiplexado por URL. `SharedEventSource` implementa a
      // superficie que este hook usa e compartilha a conexao real: dois
      // consumidores do mesmo build passam a gastar uma conexao, nao duas.
      // Toda a logica abaixo (token, backoff, o conserto do B-014) fica
      // intocada de proposito — a deduplicacao nao e assunto dela.
      es = new SharedEventSource(url, {
        token,
        lastEventId: lastIDRef.current,
      }) as unknown as EventSource;

      es.onopen = () => {
        if (cancelled) return;
        failureCount = 0;
        // B-160 — `reopenAttempts` NAO zera aqui. `onopen` prova que o socket abriu, nao
        // que o stream serve para alguma coisa: no ciclo abrir→servidor fecha→abrir ele
        // disparava a cada volta e mantinha o backoff em zero para sempre. O reset agora
        // acontece na primeira mensagem, que e a primeira evidencia de que a conexao
        // fez o trabalho dela.
        setConnected(true);
        setError(false);
      };

      const messageHandler = (event: MessageEvent) => {
        if (cancelled) return;
        reopenAttempts = 0;
        push(event.lastEventId || '', 'message', event.data);
      };
      es.onmessage = messageHandler;

      // Bind every named event type the caller asked for.
      for (const t of eventTypes) {
        es.addEventListener(t, ((event: MessageEvent) => {
          if (cancelled) return;
          push(event.lastEventId || '', t, event.data);
        }) as EventListener);
      }

      es.onerror = (evento) => {
        if (cancelled) return;
        const motivo = (evento as { reason?: StreamEndReason }).reason ?? 'network-error';

        // B-160 — a política deixou de inferir a causa a partir de `readyState`.
        //
        // O fix de B-014 lia `readyState === CLOSED` como "o browser desistiu num erro
        // HTTP, logo o token expirou". Isso era verdade no `EventSource` nativo. O
        // transporte que o substituiu (B-088) também fecha no fim LIMPO do corpo, então
        // aquele predicado passou a ser sempre verdadeiro: todo stream que terminava
        // normalmente limpava o JWT da aplicação inteira e reabria.
        //
        // `aborted` não chega aqui — `close()` não dispara `onerror`.
        if (motivo === 'aborted') return;

        setError(true);
        setConnected(false);
        failureCount += 1;

        // Um fim LIMPO nao diz nada sobre a credencial, e nao conta para o limiar: era
        // isso que fazia todo deploy encerrado limpar o JWT da aba inteira (B-160).
        const fimLimpo = motivo === 'server-closed';
        if (fimLimpo) failureCount -= 1;

        // Duas rotas levam a suspeitar do token, e as duas continuam valendo:
        //   - um erro HTTP diz de imediato que a credencial e a causa provavel (B-014);
        //   - tres falhas seguidas de qualquer natureza sugerem o mesmo (EC-3), porque a
        //     essa altura "transitorio" ja nao explica.
        const credencialSuspeita =
          motivo === 'http-error' || motivo === 'no-token' ||
          failureCount >= TOKEN_REFRESH_THRESHOLD;
        if (!credencialSuspeita && !fimLimpo) return;

        if (credencialSuspeita) clearToken();
        es?.close();

        // Backoff exponencial com jitter: sem ele, um 401 persistente (sessao de
        // fato encerrada) vira um laco de reabertura contra o servidor.
        const tentativa = reopenAttempts;
        reopenAttempts += 1;
        const base = Math.min(1000 * 2 ** tentativa, MAX_REOPEN_DELAY_MS);
        const delay = base / 2 + Math.random() * (base / 2);

        failureCount = 0;
        reopenTimer = setTimeout(() => {
          if (!cancelled) void open();
        }, delay);
      };
    };

    void open();

    return () => {
      cancelled = true;
      if (reopenTimer) clearTimeout(reopenTimer);
      es?.close();
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, eventTypesKey, maxEvents]);

  return {
    events,
    connected,
    error,
    lastEventID,
    droppedCount,
    clear: () => {
      bufferRef.current = [];
      droppedRef.current = 0;
      setEvents([]);
      setDroppedCount(0);
    },
  };
}
