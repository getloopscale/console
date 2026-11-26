import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '@/lib/http/config';
import { signOutIfSessionEnded } from '@/lib/http/api';
import { SharedEventSource } from '@/hooks/deploy/shared-event-source';
import { credentialIsSuspect, shouldReopen, type StreamEndReason } from './stream-end-reason';

/**
 * useSSEStream — generic typed SSE consumer (Plan J-17 T2.1).
 *
 * Wraps an EventSource lifecycle behind a typed event array. Each named
 * event type the caller registers in `eventTypes` is bound via
 * `addEventListener(type, handler)` so the server's `event: <type>`
 * lines flow into the same buffer.
 *
 * Features:
 * - Last-Event-ID resume on reconnect (EC-9). B-173/B-237 — este texto dizia "o navegador faz
 *   isso nativamente", e não faz: o transporte deixou de ser o `EventSource` nativo quando o JWT
 *   saiu da URL e foi para o header (`fetch-event-source.ts`). A retomada é NOSSA, e `lastEventID`
 *   é o que a alimenta.
 * - Session check when the credential is suspect (EC-3): a 401/403 makes the hook probe the
 *   session and sign out only if it ended (`credentialIsSuspect`); every other cause reopens.
 * - maxEvents FIFO cap (EC-10) — buffer cannot grow unbounded if the
 *   user leaves the tab in the background.
 * - `paused` lets the consumer freeze updates without disconnecting.
 *
 * Auth: the Kratos session cookie, sent by the browser on this same-origin request and validated
 * by theo-cloud (usetheoai/theo#477 step 3). No token in the URL, none in a header, none in memory.
 *
 * B-219 — this block once said the JWT goes in `?token=` because SSE cannot set headers; B-088
 * moved it to a header, and #477 removed it entirely. See `fetch-event-source.ts` and ADR-0009.
 */
interface SSEStreamEvent<T = unknown> {
  id: string;
  type: string;
  data: T;
  /**
   * Quando ESTE evento chegou, carimbado UMA vez na ingestão (B-224).
   *
   * Existe porque nem todo emissor manda um horário, e o consumidor que preenchia a lacuna o
   * fazia dentro de um `useMemo`: um valor derivado que lê o relógio não é derivado — é uma
   * medição nova a cada recomputação, e uma linha de log ganhava um horário de chegada diferente
   * toda vez que a lista era recalculada. Carimbar na chegada também é a leitura honesta: isto é
   * quando NÓS recebemos, não quando o servidor produziu.
   */
  receivedAt: string;
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
  /**
   * True for the last event the stream will send. After it the connection is
   * closed and not reopened: the server has nothing more to say, and a client
   * that keeps asking reopens the stream for as long as the page is open.
   */
  isFinal?: (event: SSEStreamEvent<T>) => boolean;
  /**
   * True when what the stream reports on has ended, a finished build for
   * example. The server then replays the events and closes the response, and
   * that close is the end: the stream is not reopened. For a stream with no
   * event that always comes last, where `isFinal` cannot tell (#563).
   */
  sourceEnded?: boolean;
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
  const isFinalRef = useRef(options.isFinal);
  isFinalRef.current = options.isFinal;
  const sourceEndedRef = useRef(options.sourceEnded ?? false);
  sourceEndedRef.current = options.sourceEnded ?? false;
  const bufferRef = useRef<SSEStreamEvent<T>[]>([]);
  const droppedRef = useRef(0);
  const lastIDRef = useRef<string | null>(initialLastEventID);

  // Stable join key for the eventTypes dep (re-binding on real change).
  const eventTypesKey = eventTypes.join('|');

  /**
   * B-179 — despausar mostra o que chegou durante a pausa.
   *
   * `paused` congela as atualizações SEM desconectar; é o propósito declarado dele. Mas o único
   * `useEffect` deste hook é chaveado em `[path, eventTypesKey, maxEvents]`, e a sincronização do
   * buffer acontecia só dentro de `push`. Nada era chaveado em `paused`, então quem despausava um
   * stream silencioso continuava vendo dados velhos até o PRÓXIMO evento chegar — uma pausa que
   * não se consegue desfazer, o que é pior do que não ter pausa.
   *
   * O buffer já tem tudo; o que faltava era a sincronização. Roda na transição para
   * despausado e é idempotente: sincronizar de novo com o mesmo buffer não muda nada.
   */
  useEffect(() => {
    if (paused) return;
    setEvents([...bufferRef.current]);
    setLastEventID(lastIDRef.current);
    setDroppedCount(droppedRef.current);
  }, [paused]);

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
      const event: SSEStreamEvent<T> = { id, type, data, receivedAt: new Date().toISOString() };
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
      if (isFinalRef.current?.(event)) {
        cancelled = true;
        if (reopenTimer) clearTimeout(reopenTimer);
        es?.close();
        setConnected(false);
      }
    };

    const open = () => {
      if (cancelled) return;
      // B-088 — the URL carries neither a credential nor the resume cursor. Until 2026-08-07 it
      // carried `?token=${jwt}`, which reaches access logs, proxy logs, browser history and the
      // Referer header. Since usetheoai/theo#477 step 3 there is no token at all: the request is
      // authenticated by the session cookie, and `Last-Event-ID` travels as a header.
      const url = `${API_URL}${path}`;

      // B-020 — multiplexed by URL: two consumers of the same build share one real connection.
      es = new SharedEventSource(url, {
        lastEventId: lastIDRef.current,
      }) as unknown as EventSource;

      es.onopen = () => {
        if (cancelled) return;
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
        const reason: StreamEndReason =
          (evento as { reason?: StreamEndReason }).reason ?? { kind: 'network-error' };

        // B-160 — a política deixou de inferir a causa a partir de `readyState`, porque o
        // transporte que substituiu o `EventSource` nativo (B-088) também fecha no fim LIMPO do
        // corpo: aquele predicado passou a ser sempre verdadeiro e todo deploy encerrado limpava
        // o JWT da aplicação inteira.
        //
        // B-172/B-173 — e ela deixou de inferir DUAS outras coisas.
        //
        // A primeira: `'http-error'` era tratado como suspeita de credencial, e o transporte
        // colapsava 401, 404, 500 e 503 nesse único token. Um serviço de log sobrecarregado
        // apagava o JWT de todas as telas abertas. Agora o motivo carrega o status e
        // `credentialIsSuspect` lê 401/403 — o resto não diz nada sobre quem está pedindo.
        //
        // A segunda, e a mais cara: havia um limiar de três falhas que era INALCANÇÁVEL. O
        // `FetchEventSource` dispara `onerror` no máximo uma vez por instância, e o contador
        // zerava antes de cada reabertura. Pior — uma falha de rede não era nem suspeita de
        // credencial nem fim limpo, então a função RETORNAVA sem agendar nada e o stream ficava
        // morto até o componente remontar. O contador saiu; toda causa que não fomos nós reabre.
        //
        // `aborted` não chega aqui — `close()` não dispara `onerror` —, mas `shouldReopen` o
        // trata mesmo assim: um predicado que depende de um invariante de outro módulo é um
        // predicado que quebra quando aquele módulo muda.
        if (!shouldReopen(reason)) return;

        // The source ended and the server finished the replay: nothing more will come.
        // A network or HTTP error still reopens, because it may have cut the replay short.
        if (reason.kind === 'server-closed' && sourceEndedRef.current) {
          cancelled = true;
          es?.close();
          setConnected(false);
          return;
        }

        setError(true);
        setConnected(false);

        // A 401/403 may mean the session ended. The probe decides; a transient failure keeps
        // reopening with backoff instead of signing anyone out (#324).
        if (credentialIsSuspect(reason)) void signOutIfSessionEnded();
        es?.close();

        // Backoff exponencial com jitter: sem ele, um 401 persistente (sessao de
        // fato encerrada) vira um laco de reabertura contra o servidor.
        const tentativa = reopenAttempts;
        reopenAttempts += 1;
        const base = Math.min(1000 * 2 ** tentativa, MAX_REOPEN_DELAY_MS);
        const delay = base / 2 + Math.random() * (base / 2);

        reopenTimer = setTimeout(() => {
          if (!cancelled) open();
        }, delay);
      };
    };

    open();

    return () => {
      cancelled = true;
      if (reopenTimer) clearTimeout(reopenTimer);
      es?.close();
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, eventTypesKey, maxEvents]);

  /**
   * B-221 — o handle devolvido é referencialmente ESTÁVEL.
   *
   * Antes, o objeto e o `clear` eram literais novos a cada render, então todo consumidor que
   * colocasse o resultado numa lista de dependências re-executava a cada render. Era o contrato
   * deste hook empurrando trabalho para quem o chama — e a consequência medida está no
   * `use-log-stream`, onde a troca de identidade do array fazia o carimbo de horário ser
   * refeito a cada recomputação (B-224).
   *
   * Estável não é parado: `events`, `connected`, `error`, `lastEventID` e `droppedCount` estão
   * nas dependências, então o objeto muda quando um valor muda — e só então.
   */
  const clear = useCallback(() => {
    bufferRef.current = [];
    droppedRef.current = 0;
    setEvents([]);
    setDroppedCount(0);
  }, []);

  return useMemo(
    () => ({ events, connected, error, lastEventID, droppedCount, clear }),
    [events, connected, error, lastEventID, droppedCount, clear],
  );
}
