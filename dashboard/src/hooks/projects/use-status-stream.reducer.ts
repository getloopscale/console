/**
 * Reducer puro dos sinais de status — sem React, sem rede.
 *
 * B-015 — separado de `use-status-stream.ts` porque as duas coisas mudam por
 * razões diferentes. A dicotomia terminal-vs-oscilante é regra de PRODUTO
 * (`status` chega a Healthy e absorve; `replicas` flutua para sempre); o hook é
 * transporte. Enquanto conviviam, testar a regra exigia montar um hook e mockar
 * um EventSource — e foi por isso que a regra sobreviveu intacta a uma migração
 * revertida sem que ninguém precisasse verificá-la.
 */

/** The 8 canonical signal names for J-18 SignalGrid. */
export type SignalName =
  | 'status'
  | 'alerts_active'
  | 'replicas'
  | 'uptime_24h'
  | 'p95_latency'
  | 'error_rate'
  | 'rps'
  | 'last_deploy_time';

/** Per-signal categorization for the dichotomy reducer. Locked in v1.1 ADR D3. */
export const TERMINAL_ABSORBING_SIGNALS: ReadonlySet<SignalName> = new Set([
  'status',
  'alerts_active',
] as const);

export const OSCILLATING_SIGNALS: ReadonlySet<SignalName> = new Set([
  'replicas',
  'uptime_24h',
  'p95_latency',
  'error_rate',
  'rps',
  'last_deploy_time',
] as const);

/**
 * Terminal absorption rules — when a TERMINAL_ABSORBING signal reaches one of
 * these values, subsequent events for the same signal are ignored.
 *
 * 'status' is terminal when 'Healthy' (Vercel-style: success absorbs).
 * 'alerts_active' is terminal when count drops to 0 (alerts cleared absorbs).
 */
export function isTerminalValue(signal: SignalName, value: unknown): boolean {
  if (signal === 'status') {
    return value === 'Healthy';
  }
  if (signal === 'alerts_active') {
    return value === 0;
  }
  return false;
}

/** Signal event delivered over SSE from backend T1.3 handler. */
export interface SignalEvent {
  signal: SignalName;
  value: unknown;
  /** Optional ISO timestamp; UI may render last-changed indicator. */
  ts?: string;
}

/** Per-signal state in the reducer accumulator. */
interface SignalState {
  value: unknown;
  /** Set to true once a terminal value is observed (TERMINAL_ABSORBING signals only). */
  terminal: boolean;
  ts?: string;
}

/** Map signal name to current state. */
export type SignalsMap = Partial<Record<SignalName, SignalState>>;

/**
 * applySignalEvent — pure reducer step. Applies dichotomy policy.
 *
 * - TERMINAL_ABSORBING + terminal already reached → IGNORE (absorbs).
 * - TERMINAL_ABSORBING + not terminal yet → adopt value; mark terminal if
 *   the new value is itself terminal.
 * - OSCILLATING → always-latest (no terminal-absorbing).
 * - Unknown signal name → adopt as OSCILLATING (defensive default).
 */
export function applySignalEvent(state: SignalsMap, event: SignalEvent): SignalsMap {
  const current = state[event.signal];

  if (TERMINAL_ABSORBING_SIGNALS.has(event.signal)) {
    // Defense: already-terminal state absorbs subsequent events.
    if (current?.terminal) {
      return state;
    }
    return {
      ...state,
      [event.signal]: {
        value: event.value,
        terminal: isTerminalValue(event.signal, event.value),
        ts: event.ts,
      },
    };
  }

  // OSCILLATING (or unknown): always-latest.
  return {
    ...state,
    [event.signal]: {
      value: event.value,
      terminal: false,
      ts: event.ts,
    },
  };
}
