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
 * The transport is the only layer that knows which branch it took. It reports; the consumer
 * decides. A state is not a cause.
 */
export type StreamEndReason =
  /** The server finished the response body. Not an error — reconnect, keep the token. */
  | 'server-closed'
  /** Non-2xx. The credential is the likely cause, so it is worth refreshing. */
  | 'http-error'
  /** No credential was available to open the stream at all. */
  | 'no-token'
  /** The request or the reader threw. Transient; reconnect, keep the token. */
  | 'network-error'
  /** We closed it ourselves. Not a failure, and nothing should react to it. */
  | 'aborted';

/** An `error` event carrying the reason the stream ended. */
export interface StreamEndEvent extends Event {
  readonly reason: StreamEndReason;
}

/** Builds the event the transport dispatches, so the shape lives in one place. */
export function streamEndEvent(reason: StreamEndReason): StreamEndEvent {
  return Object.assign(new Event('error'), { reason }) as StreamEndEvent;
}
