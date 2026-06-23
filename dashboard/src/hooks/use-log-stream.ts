import { useMemo } from 'react';
import type { LogLine } from '@/lib/api/types';
import { useSSEStream } from './use-sse-stream';

/**
 * use-log-stream — consumes a SSE log stream into a growing line buffer.
 *
 * Plan J-17 T2.4: this hook is now a thin wrapper over `useSSEStream`,
 * the canonical SSE primitive. The public API is unchanged so the two
 * consumers (build-logs, runtime-logs pages) need no edit. The benefit
 * is that the log stream now inherits Last-Event-ID resume + token
 * refresh on 401 + FIFO cap for free.
 *
 * Backwards-compatible behavior:
 *   - paused freezes setLines without closing the connection
 *   - lines cap at maxLines (default 5000) FIFO
 *   - clear() resets the buffer
 *   - non-JSON server payloads are wrapped into a synthetic LogLine
 *     with level=info — same fallback the previous inline EventSource
 *     implementation had.
 */
export interface UseLogStreamOptions {
  maxLines?: number;
  paused?: boolean;
}

interface UseLogStreamResult {
  lines: LogLine[];
  connected: boolean;
  error: boolean;
  /** Total lines dropped by the FIFO maxLines cap since the last clear() (J-19 T1.3 R3). */
  droppedCount: number;
  clear: () => void;
}

export function useLogStream(
  path: string | null,
  options: UseLogStreamOptions = {},
): UseLogStreamResult {
  const { maxLines = 5000, paused = false } = options;

  const stream = useSSEStream<LogLine | string>(path, {
    maxEvents: maxLines,
    paused,
    // J-19 T1.3 (R3): the theo-api runtime log stream emits NAMED `event: log`
    // frames — bind them via addEventListener('log') (unnamed `message` frames
    // are also captured by useSSEStream). Without this, named frames are dropped.
    eventTypes: ['log'],
  });

  const lines = useMemo<LogLine[]>(() => {
    return stream.events.map((ev) => {
      const data = ev.data;
      // useSSEStream casts JSON-parse failures into the raw string under
      // the requested type. Detect and wrap so consumers always see a
      // canonical LogLine shape (mirrors the legacy inline fallback).
      if (typeof data === 'string') {
        return { ts: new Date().toISOString(), level: 'info', msg: data };
      }
      // J-19: map the theo-api runtime shape {timestamp, line, step} onto the
      // canonical LogLine {ts, msg, source}; pass-through when already canonical.
      const raw = data as Partial<LogLine> & {
        timestamp?: string;
        line?: string;
        step?: string;
      };
      const source = raw.source ?? raw.step;
      return {
        ts: raw.ts ?? raw.timestamp ?? new Date().toISOString(),
        level: raw.level ?? 'info',
        msg: raw.msg ?? raw.line ?? '',
        ...(source !== undefined ? { source } : {}),
      };
    });
  }, [stream.events]);

  return {
    lines,
    connected: stream.connected,
    error: stream.error,
    droppedCount: stream.droppedCount,
    clear: stream.clear,
  };
}
