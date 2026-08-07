import { useEffect, useRef, useState } from 'react';
import { API_URL } from '@/lib/http/config';
import { ensureSSEToken, clearToken } from '@/lib/http/api';
import { SharedEventSource } from '@/hooks/deploy/shared-event-source';

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
const EVENTSOURCE_CLOSED = 2;

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
      const separator = path.includes('?') ? '&' : '?';
      const baseUrl = `${API_URL}${path}${separator}token=${encodeURIComponent(token)}`;
      // Inject Last-Event-ID into URL because EventSource does not let
      // us set custom headers manually. Server-side handler treats
      // ?last_event_id= and the Last-Event-ID header equivalently
      // (existing stream_handler resume logic).
      const url = lastIDRef.current
        ? `${baseUrl}&last_event_id=${encodeURIComponent(lastIDRef.current)}`
        : baseUrl;

      // B-020 — multiplexado por URL. `SharedEventSource` implementa a
      // superficie que este hook usa e compartilha a conexao real: dois
      // consumidores do mesmo build passam a gastar uma conexao, nao duas.
      // Toda a logica abaixo (token, backoff, o conserto do B-014) fica
      // intocada de proposito — a deduplicacao nao e assunto dela.
      es = new SharedEventSource(url) as unknown as EventSource;

      es.onopen = () => {
        if (cancelled) return;
        failureCount = 0;
        // Conexao boa: zera o backoff para que a proxima falha recomece curta.
        reopenAttempts = 0;
        setConnected(true);
        setError(false);
      };

      const messageHandler = (event: MessageEvent) => {
        if (cancelled) return;
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

      es.onerror = () => {
        if (cancelled) return;
        setError(true);
        setConnected(false);
        failureCount += 1;

        // B-014 — o limiar de 3 nunca disparava no caso que mais importa.
        //
        // Num erro HTTP nao-2xx (401 de token expirado, tipicamente) o browser
        // FECHA o EventSource: readyState vai para CLOSED e ele NAO tenta
        // reconectar. `onerror` roda uma unica vez, `failureCount` para em 1, e
        // a recuperacao de token — que existe exatamente para esse cenario —
        // nunca acontecia. O stream ficava morto em silencio ate a navegacao
        // seguinte.
        //
        // CLOSED e terminal: recupera de imediato. O contador de 3 continua
        // valendo para CONNECTING, em que o browser ja esta retentando sozinho e
        // reabrir na primeira falha so brigaria com ele.
        const fechadoPeloBrowser = es?.readyState === EVENTSOURCE_CLOSED;
        if (!fechadoPeloBrowser && failureCount < TOKEN_REFRESH_THRESHOLD) return;

        // EC-3: token provavelmente expirado. Limpa o JWT em cache para que o
        // proximo ensureSSEToken() force uma troca nova, e reabre explicitamente
        // — a reconexao nativa do browser reusaria a URL com o token velho.
        clearToken();
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
