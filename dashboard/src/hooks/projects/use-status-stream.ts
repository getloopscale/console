import { useMemo, useRef, useState } from 'react';
import { useSSEStream } from '@/hooks/deploy/use-sse-stream';
import {
  applySignalEvent,
  type SignalEvent,
  type SignalsMap,
} from '@/hooks/projects/use-status-stream.reducer';

export * from '@/hooks/projects/use-status-stream.reducer';

/**
 * use-status-stream — os sinais de runtime de um projeto, por SSE.
 *
 * ## B-015, e por que ele levou dois turnos
 *
 * Este hook abria um `EventSource` cru com `withCredentials: true`, enquanto os
 * outros quatro consumidores de SSE passavam pela primitiva `useSSEStream`.
 * Divergência real: sem refresh de token, sem backoff, sem o conserto do B-014.
 *
 * A primeira migração foi **revertida** (4c52dc1) e a reversão estava certa: a
 * primitiva autenticava com `?token=<jwt>` na URL, e unificar teria levado o
 * quinto stream para a exposição de credencial que o B-088 documentou. O ganho
 * de resiliência não pagava o custo.
 *
 * O B-088 removeu a razão: a primitiva agora fala por `fetch` e manda o token em
 * `Authorization`. A migração acontece sem o preço.
 *
 * ## O que a reversão escondeu
 *
 * `withCredentials: true` autentica por COOKIE — e o middleware da API cloud
 * **não lê cookie** (`internal/auth/middleware.go:143`, medido no ADR-0009).
 * Este hook não estava apenas divergente: ele daria 401 no instante em que
 * alguém o religasse. B-051 removeu o único consumidor em `project-status.tsx`,
 * e é só por isso que o defeito nunca apareceu.
 *
 * Então a migração não é arrumação: é o que faz o hook funcionar quando a
 * assinatura voltar — e `project-status.tsx:88` documenta a linha exata de como
 * religá-la.
 *
 * ## O reducer não mora aqui
 *
 * A dicotomia terminal-vs-oscilante é regra de produto e vive em
 * `use-status-stream.reducer.ts`. Ela sobreviveu intacta a uma migração e a uma
 * reversão; separá-la é o que permite testá-la sem montar um hook.
 */

export interface UseStatusStreamResult {
  signals: SignalsMap;
  connected: boolean;
}

export function useStatusStream(
  projectName: string | null | undefined,
  env: string | null | undefined,
): UseStatusStreamResult {
  const [signals, setSignals] = useState<SignalsMap>({});
  // O reducer é acumulativo e o `onEvent` da primitiva não recebe o estado
  // anterior. O ref é o que permite reduzir sem re-assinar o stream a cada
  // evento — uma dependência em `signals` recriaria o callback e, com ele, a
  // conexão, a cada sinal recebido.
  const signalsRef = useRef<SignalsMap>({});

  const path =
    projectName && env
      ? `/engine/api/v1/projects/${encodeURIComponent(projectName)}/signals/stream?env=${encodeURIComponent(env)}`
      : null;

  const { connected } = useSSEStream<SignalEvent>(path, {
    // O backend emite `event: signal.changed` NOMEADO. `onmessage` sozinho
    // descartaria tudo em silêncio — absorção registrada em
    // `feedback_eventsource_named_events_vs_onmessage`.
    eventTypes: ['signal.changed'],
    onEvent: (evento) => {
      const payload = evento.data;
      if (!payload?.signal) return;
      signalsRef.current = applySignalEvent(signalsRef.current, payload);
      setSignals(signalsRef.current);
    },
  });

  return useMemo(() => ({ signals, connected }), [signals, connected]);
}
