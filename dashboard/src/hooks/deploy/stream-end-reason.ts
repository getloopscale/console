// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

/**
 * Why a server-sent-event stream stopped.
 *
 * `readyState` cannot answer this. When the native `EventSource` was replaced by a fetch
 * transport (B-088), `CLOSED` stopped meaning "the browser gave up on an HTTP error" and
 * started meaning that OR "the server finished cleanly" — and `useSSEStream` still read it
 * as the former, so it cleared the application-wide JWT every time a deploy's stream ended
 * normally, then reopened, forever (B-160).
 *
 * The transport is the only layer that knows which branch it took. A state is not a cause.
 *
 * ## O que este módulo decide, e o que não decide (B-237)
 *
 * O texto anterior terminava em "ele reporta; o consumidor decide", e a revisão notou que o módulo
 * abriga dois predicados — `credentialIsSuspect` e `shouldReopen` — que parecem decisões. A frase
 * é que era imprecisa, não o lugar deles.
 *
 * A causa e a CLASSIFICAÇÃO da causa são a mesma matéria e moram juntas: só quem conhece as
 * variantes sabe que um 401 põe a credencial em dúvida e um fim limpo de resposta não. O que o
 * consumidor decide é o que FAZER com a classificação — reabrir agora ou depois, trocar o token,
 * desistir. Mover os predicados para o consumidor não os tornaria decisões dele; duplicaria a
 * classificação no dia em que houvesse um segundo.
 */
type StreamEndKind =
  /** The server finished the response body. Not an error — reconnect, keep the token. */
  | 'server-closed'
  /** Non-2xx. Carries the status: see `StreamEndReason` and B-172. */
  | 'http-error'
  /** No credential was available to open the stream at all. */
  | 'no-token'
  /** The request or the reader threw. Transient; reconnect, keep the token. */
  | 'network-error'
  /** We closed it ourselves. Not a failure, and nothing should react to it. */
  | 'aborted';

/**
 * B-172 — o motivo passou a carregar o STATUS, e não só a classe.
 *
 * B-160 estabeleceu que o transporte relata e o consumidor decide, e parou um nível cedo: o
 * transporte dizia QUE foi um erro HTTP, nunca QUAL. Sem o status, a única política que o
 * consumidor conseguia escrever era "qualquer não-2xx significa a credencial" — e foi assim que um
 * 503 de um serviço de log sobrecarregado passou a apagar o JWT de todas as telas abertas.
 *
 * O status é conhecido em `fetch-event-source.ts` no momento da resposta e era descartado na linha
 * seguinte. Uma união discriminada o carrega até quem decide.
 */
export type StreamEndReason =
  | { readonly kind: Exclude<StreamEndKind, 'http-error'> }
  | { readonly kind: 'http-error'; readonly status: number };

/** An `error` event carrying the reason the stream ended. */
export interface StreamEndEvent extends Event {
  readonly reason: StreamEndReason;
}

/** Builds the event the transport dispatches, so the shape lives in one place. */
export function streamEndEvent(reason: StreamEndReason): StreamEndEvent {
  return Object.assign(new Event('error'), { reason }) as StreamEndEvent;
}

/**
 * A credencial é a causa provável deste fim?
 *
 * O predicado mora aqui, junto do tipo, porque é a ÚNICA leitura que justifica tocar num token —
 * e um predicado nomeado é testável sem montar um stream. `403` entra junto de `401`: um token
 * válido para outra coisa é tão inútil para este stream quanto um expirado, e o remédio (trocar a
 * credencial) é o mesmo. `404` e `5xx` não dizem nada sobre quem está pedindo.
 */
export function credentialIsSuspect(reason: StreamEndReason): boolean {
  if (reason.kind === 'no-token') return true;
  return reason.kind === 'http-error' && (reason.status === 401 || reason.status === 403);
}

/** Este fim pede uma reabertura? Tudo que não foi fechado por nós pede (B-173). */
export function shouldReopen(reason: StreamEndReason): boolean {
  return reason.kind !== 'aborted';
}
