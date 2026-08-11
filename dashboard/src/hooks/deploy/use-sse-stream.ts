import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '@/lib/http/config';
import { ensureSSEToken, clearToken } from '@/lib/http/api';
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
 * Auth: the JWT travels in an `Authorization: Bearer` HEADER.
 *
 * B-219 — este bloco dizia "SSE não aceita header, então o JWT vai em `?token=`", que era verdade
 * do `EventSource` nativo e deixou de ser em B-088: o transporte passou a ser `fetch`, que aceita
 * header, precisamente para tirar a credencial da query string — de onde ela chegava a access log
 * do nginx, log de proxy, histórico do navegador e header `Referer`. O texto sobreviveu ao motivo
 * pelo qual ele existia, descrevendo um risco que já tinha sido fechado logo abaixo dele.
 * Ver `fetch-event-source.ts § abrir` e o ADR-0009.
 */
export interface SSEStreamEvent<T = unknown> {
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
        const motivo: StreamEndReason =
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
        if (!shouldReopen(motivo)) return;

        setError(true);
        setConnected(false);

        if (credentialIsSuspect(motivo)) clearToken();
        es?.close();

        // Backoff exponencial com jitter: sem ele, um 401 persistente (sessao de
        // fato encerrada) vira um laco de reabertura contra o servidor.
        const tentativa = reopenAttempts;
        reopenAttempts += 1;
        const base = Math.min(1000 * 2 ** tentativa, MAX_REOPEN_DELAY_MS);
        const delay = base / 2 + Math.random() * (base / 2);

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
