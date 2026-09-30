import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useLogStream } from './use-log-stream';
import type { LogLine } from '@/lib/api/types';
import { __setTransporte } from '@/hooks/deploy/shared-event-source';

// Mock ensureSSEToken to bypass network — returns deterministic token.
vi.mock('@/lib/http/api', () => ({
  signOutIfSessionEnded: vi.fn(async () => false),
}));

/**
 * EventSource mock — extended for J-19 BLOCKER F-tests-2 closure (2026-06-13).
 *
 * SSE protocol distinguishes two channels:
 *   - UNNAMED `data: {...}\n\n` → fires `onmessage`
 *   - NAMED `event: log\ndata:{...}\n\n` → fires `addEventListener('log',...)`
 *
 * theo-api emits NAMED `event: log` (api/internal/routes/logs_stream.go
 * writeSSELogEvent). useLogStream now subscribes to both channels per
 * 2026-06-13 LIVE walkthrough fix (commit bfde4349). Hermetic tests
 * MUST exercise BOTH paths to prevent regression of the LIVE catch.
 */
type EventListenerEntry = (ev: MessageEvent) => void;

class TestEventSource {
  static instances: TestEventSource[] = [];
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  readyState = 0;
  private namedListeners = new Map<string, EventListenerEntry[]>();

  /** B-088 — token e cursor viajam em header; o fake guarda para poder assertar. */
  opcoes: { lastEventId?: string | null } | undefined;
  constructor(url: string, opcoes?: { lastEventId?: string | null }) {
    this.opcoes = opcoes;
    this.url = url;
    TestEventSource.instances.push(this);
    // Fire onopen on next microtask (simulate async connect)
    Promise.resolve().then(() => {
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    });
  }

  addEventListener(type: string, handler: EventListenerEntry) {
    const arr = this.namedListeners.get(type) ?? [];
    arr.push(handler);
    this.namedListeners.set(type, arr);
  }

  emit(line: LogLine) {
    // Unnamed-event path (legacy / build-logs).
    const ev = new MessageEvent('message', { data: JSON.stringify(line) });
    this.onmessage?.(ev);
  }

  // F-tests-2 closure — named-event dispatch (theo-api runtime SSE).
  // Accepts the canonical theo-api shape {timestamp, line, step} which
  // useLogStream maps to LogLine {ts, level, msg, source}.
  emitNamed(eventType: string, data: Record<string, unknown>) {
    const ev = new MessageEvent(eventType, { data: JSON.stringify(data) });
    const arr = this.namedListeners.get(eventType) ?? [];
    arr.forEach((h) => h(ev));
  }

  close() {
    this.readyState = 2;
  }
}

const TS_BASE = Date.now();
const mkLine = (i: number): LogLine => ({
  ts: new Date(TS_BASE + i).toISOString(),
  level: 'info',
  msg: `line ${i}`,
});

describe('useLogStream (J-19 T1.3 — R3 droppedCount field)', () => {
  beforeEach(() => {
    TestEventSource.instances = [];
    // B-088 — o transporte deixou de ser o EventSource global (o JWT saiu da
    // URL e foi para o header). O fake abaixo continua valendo: a superficie e
    // a mesma; o que muda e onde ele e instalado.
    __setTransporte((url, opcoes) => new TestEventSource(url, opcoes) as unknown as EventSource);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setupHook(maxLines: number) {
    const r = renderHook(() => useLogStream('/test/path', { maxLines }));
    await waitFor(() => expect(TestEventSource.instances.length).toBe(1));
    return r;
  }

  it('test_use_log_stream_dropped_count_one_after_5001_lines', async () => {
    const { result } = await setupHook(5000);
    const es = TestEventSource.instances[0];
    act(() => {
      for (let i = 0; i < 5001; i++) es.emit(mkLine(i));
    });
    expect(result.current.droppedCount).toBe(1);
    expect(result.current.lines.length).toBe(5000);
  });

  it('test_use_log_stream_dropped_count_one_thousand_after_6000_lines', async () => {
    const { result } = await setupHook(5000);
    const es = TestEventSource.instances[0];
    act(() => {
      for (let i = 0; i < 6000; i++) es.emit(mkLine(i));
    });
    expect(result.current.droppedCount).toBe(1000);
    expect(result.current.lines.length).toBe(5000);
  });

  it('test_use_log_stream_dropped_count_resets_on_clear', async () => {
    const { result } = await setupHook(100);
    const es = TestEventSource.instances[0];
    act(() => {
      for (let i = 0; i < 250; i++) es.emit(mkLine(i));
    });
    expect(result.current.droppedCount).toBe(150);
    act(() => {
      result.current.clear();
    });
    expect(result.current.droppedCount).toBe(0);
    expect(result.current.lines.length).toBe(0);
  });

  it('test_use_log_stream_backward_compat_destructuring_no_droppedCount', async () => {
    // EC-6 backward compat: existing build-logs.tsx destructures
    // {lines, connected, error, clear} without droppedCount. New field
    // is additive (extension, not breaking) — destructuring without it
    // must still resolve every existing field.
    const { result } = await setupHook(5000);
    const { lines, connected, error, clear } = result.current;
    expect(Array.isArray(lines)).toBe(true);
    expect(typeof connected).toBe('boolean');
    expect(typeof error).toBe('boolean');
    expect(typeof clear).toBe('function');
  });

  // iter 13 productive-idle — lifecycle integration coverage
  it('test_use_log_stream_error_event_sets_error_state', async () => {
    const { result } = await setupHook(5000);
    const es = TestEventSource.instances[0];
    expect(result.current.error).toBe(false);
    act(() => {
      es.onerror?.(new Event('error'));
    });
    expect(result.current.error).toBe(true);
    expect(result.current.connected).toBe(false);
  });

  it('test_use_log_stream_path_change_resets_all_state', async () => {
    const { result, rerender } = renderHook(
      ({ path }) => useLogStream(path, { maxLines: 100 }),
      { initialProps: { path: '/test/path-A' } },
    );
    await waitFor(() => expect(TestEventSource.instances.length).toBeGreaterThanOrEqual(1));
    const esA = TestEventSource.instances[0];
    act(() => {
      for (let i = 0; i < 150; i++) esA.emit(mkLine(i));
      esA.onerror?.(new Event('error'));
    });
    expect(result.current.droppedCount).toBeGreaterThan(0);
    expect(result.current.error).toBe(true);
    // Change path → new EventSource opens → state resets per useEffect[path]
    rerender({ path: '/test/path-B' });
    await waitFor(() => expect(TestEventSource.instances.length).toBeGreaterThanOrEqual(2));
    expect(result.current.droppedCount).toBe(0);
    expect(result.current.error).toBe(false);
    expect(result.current.lines.length).toBe(0);
  });

  it('test_use_log_stream_null_path_no_op', async () => {
    const { result } = renderHook(() => useLogStream(null, { maxLines: 100 }));
    // No EventSource constructed, no state mutation
    expect(TestEventSource.instances.length).toBe(0);
    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBe(false);
    expect(result.current.lines.length).toBe(0);
    expect(result.current.droppedCount).toBe(0);
  });

  it('test_use_log_stream_paused_holds_lines_in_buffer_no_render', async () => {
    const { result, rerender } = renderHook(
      ({ paused }: { paused: boolean }) => useLogStream('/test/path', { maxLines: 100, paused }),
      { initialProps: { paused: false } },
    );
    await waitFor(() => expect(TestEventSource.instances.length).toBe(1));
    const es = TestEventSource.instances[0];
    act(() => {
      es.emit(mkLine(0));
    });
    expect(result.current.lines.length).toBe(1);
    // Pause: subsequent emits NOT reflected in lines, but buffer still grows
    rerender({ paused: true });
    act(() => {
      es.emit(mkLine(1));
      es.emit(mkLine(2));
    });
    expect(result.current.lines.length).toBe(1); // last rendered was pre-pause
    // Resume: NOT auto-replayed by hook; design — caller renders next event
    // (canonical pattern: paused freezes UI; doesn't backfill on resume)
  });

  // 2026-06-13 LIVE walkthrough fix gates — BLOCKER F-tests-2 closure
  // (commit bfde4349). theo-api emits NAMED event 'log' with payload shape
  // {timestamp, line, step}. useLogStream now listens via addEventListener
  // ('log', handler) + maps to LogLine {ts, msg, source}. Prior hermetic
  // tests covered only onmessage (unnamed) path — missing this channel
  // is the bug class that allowed sponsor to see "No log lines yet" with
  // backend streaming successfully.
  it('test_use_log_stream_renders_named_log_event_from_theo_api', async () => {
    const { result } = await setupHook(100);
    const es = TestEventSource.instances[0];
    act(() => {
      es.emitNamed('log', {
        timestamp: '2026-06-13T10:30:00Z',
        line: 'request status=200',
        step: 'api',
      });
    });
    expect(result.current.lines.length).toBe(1);
    expect(result.current.lines[0].msg).toBe('request status=200');
    expect(result.current.lines[0].ts).toBe('2026-06-13T10:30:00Z');
    expect(result.current.lines[0].source).toBe('api');
  });

  it('test_use_log_stream_maps_theo_api_shape_timestamp_to_ts_line_to_msg_step_to_source', async () => {
    // Field-name mapping regression gate: theo-api {timestamp,line,step}
    // → LogLine {ts,level='info',msg,source}. Prevents future drift where
    // payload uses {ts,msg,source} (legacy) vs {timestamp,line,step}
    // (theo-api 2026-05-13 Beta Logs Gate shape).
    const { result } = await setupHook(100);
    const es = TestEventSource.instances[0];
    act(() => {
      es.emitNamed('log', {
        timestamp: '2026-06-13T11:00:00Z',
        line: '\x1b[31mERROR\x1b[0m connection refused',
        step: 'pod-runtime',
      });
    });
    expect(result.current.lines.length).toBe(1);
    const got = result.current.lines[0];
    expect(got.ts).toBe('2026-06-13T11:00:00Z');
    expect(got.level).toBe('info'); // default when payload omits level
    expect(got.msg).toContain('ERROR');
    expect(got.source).toBe('pod-runtime');
  });

  it('test_use_log_stream_backward_compat_legacy_logline_shape_via_onmessage', async () => {
    // build-logs handler still emits the legacy unnamed-event with
    // LogLine shape {ts,level,msg,source}. Hook MUST keep onmessage path
    // working for backward compat (cf. cloud/dashboard/src/pages/build-logs.tsx).
    const { result } = await setupHook(100);
    const es = TestEventSource.instances[0];
    act(() => {
      es.emit({
        ts: '2026-06-13T12:00:00Z',
        level: 'warn',
        msg: 'legacy unnamed payload',
        source: 'build',
      });
    });
    expect(result.current.lines.length).toBe(1);
    expect(result.current.lines[0].level).toBe('warn');
    expect(result.current.lines[0].msg).toBe('legacy unnamed payload');
  });

  it('test_use_log_stream_named_and_unnamed_events_buffer_together', async () => {
    // Mixed-source defensive: a single EventSource could in theory receive
    // both named + unnamed events. Buffer order MUST preserve arrival.
    const { result } = await setupHook(100);
    const es = TestEventSource.instances[0];
    act(() => {
      es.emit(mkLine(1));
      es.emitNamed('log', {
        timestamp: '2026-06-13T12:05:00Z',
        line: 'second from named',
        step: 'runtime',
      });
      es.emit(mkLine(2));
    });
    expect(result.current.lines.length).toBe(3);
    expect(result.current.lines[1].msg).toBe('second from named');
  });
});

describe('B-224/B-237 — uma linha SEM horário do servidor recebe o horário de chegada, e ele não se move', () => {
  beforeEach(() => {
    TestEventSource.instances = [];
    __setTransporte((url, opcoes) => new TestEventSource(url, opcoes) as unknown as EventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * O defeito do B-224: o carimbo era `new Date().toISOString()` DENTRO do memo, então uma linha
   * sem horário do servidor ganhava um horário novo a cada RECOMPUTAÇÃO da lista — a coluna andava
   * sozinha enquanto ninguém tocava em nada.
   *
   * Nenhum teste pegava porque toda fixture deste arquivo traz `ts`. E a primeira versão destes
   * casos também não pegava: `rerender()` não recomputa um `useMemo` cujas dependências não
   * mudaram. O que RECOMPUTA é uma linha nova chegando — e é por isso que cada caso abaixo emite
   * uma segunda linha, com o relógio adiantado, antes de reler o carimbo da primeira.
   */
  async function montar() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-11T10:00:00.000Z'));
    const r = renderHook(() => useLogStream('/x', { maxLines: 100 }));
    await waitFor(() => { expect(TestEventSource.instances.length).toBe(1); });
    return { ...r, es: TestEventSource.instances[0] };
  }

  it('uma linha de TEXTO CRU mantém o carimbo quando outra linha chega depois', async () => {
    const { result, es } = await montar();

    act(() => {
      es.onmessage?.(new MessageEvent('message', { data: 'nao sou json' }));
    });
    await waitFor(() => { expect(result.current.lines.length).toBe(1); });
    const primeiro = result.current.lines[0].ts;
    expect(primeiro, 'a linha crua precisa receber um carimbo').toBeTruthy();
    expect(result.current.lines[0].msg).toBe('nao sou json');

    // Um minuto depois, outra linha. É esta chegada que recomputa a lista inteira — e era aqui que
    // o carimbo da PRIMEIRA linha era refeito.
    vi.setSystemTime(new Date('2026-08-11T10:01:00.000Z'));
    act(() => {
      es.onmessage?.(new MessageEvent('message', { data: 'segunda linha' }));
    });
    await waitFor(() => { expect(result.current.lines.length).toBe(2); });

    expect(result.current.lines[0].ts).toBe(primeiro);
    expect(result.current.lines[1].ts).not.toBe(primeiro);
  });

  it('um payload sem `timestamp` também mantém o horário de chegada', async () => {
    const { result, es } = await montar();

    act(() => { es.emitNamed('log', { line: 'sem horario', step: 'build' }); });
    await waitFor(() => { expect(result.current.lines.length).toBe(1); });
    const primeiro = result.current.lines[0].ts;
    expect(primeiro).toBeTruthy();

    vi.setSystemTime(new Date('2026-08-11T10:02:00.000Z'));
    act(() => { es.emitNamed('log', { line: 'outra', step: 'build' }); });
    await waitFor(() => { expect(result.current.lines.length).toBe(2); });

    expect(result.current.lines[0].ts).toBe(primeiro);
  });

  it('mas um horário do SERVIDOR vence o de chegada', async () => {
    // O contraponto: a correção não pode virar "carimba tudo na chegada" — quando o servidor diz
    // quando a linha aconteceu, é isso que a coluna tem de mostrar.
    const { result, es } = await montar();

    act(() => {
      es.emitNamed('log', { timestamp: '2020-01-01T00:00:00.000Z', line: 'com horario' });
    });

    await waitFor(() => { expect(result.current.lines.length).toBe(1); });
    expect(result.current.lines[0].ts).toBe('2020-01-01T00:00:00.000Z');
  });
});
