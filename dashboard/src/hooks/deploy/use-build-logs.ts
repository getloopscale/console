import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLogStream, capLogLines, MAX_LOG_LINES } from '@/hooks/deploy/use-log-stream';
import { useDeployment } from '@/hooks/deploy/use-deployment';
import { engineFetch } from '@/lib/http/api';
import { normalizeBuildStatus } from '@/lib/api/types';
import type { LogLine, LogLevel } from '@/lib/api/types';

/**
 * useBuildLogs — snapshot REST + delta SSE dos logs de um build.
 *
 * B-045 — este padrao (snapshot por REST, delta por SSE, merge dos dois) ja
 * tinha um dono no repo: `use-deployments-list-stream.ts`. O LogsTab o
 * reimplementou a mao com cinco useState soltos, e a copia divergiu do original
 * exatamente onde uma copia diverge — nos detalhes que so aparecem depois.
 *
 * O caso concreto: B-016 aplicou o teto FIFO ao snapshot inicial e NAO ao
 * caminho de Refresh manual, porque eram dois `setHistorical(...)` distintos em
 * lugares distintos do componente. Com um dono unico, o cap e aplicado no unico
 * ponto que escreve o snapshot, e o escape deixa de ser possivel.
 *
 * A pagina passa a ser so render.
 */

interface BackendLogEntry {
  step?: string;
  stream?: string;
  content?: string;
  // LIVE bug 2026-06-06: backend emits `timestamp` (verified via curl);
  // `time` accepted as fallback for forward-compat.
  timestamp?: string;
  time?: string;
}

interface BackendLogsResponse {
  build_id: string;
  status: string;
  entries: BackendLogEntry[];
  total_lines: number;
}

/**
 * Convert backend LogEntry → frontend LogLine.
 *
 * Plan J-17 Layer 4 (2026-06-06): pipeline lines that go through the
 * the `::theo::` marker wrapper come prefixed with
 *   `::theo:: phase=X step=Y level=Z msg="..."`
 * Strip the marker and surface only the human message + structured
 * fields. The phase is used as source so the LogViewer can color-code
 * by phase group (clone / install / build / sign / deliver).
 *
 * Lines without the marker still render via the legacy fallback —
 * useful for debug mode (raw container output).
 */
const THEO_MARKER_RE =
  /^::theo:: phase=(?<phase>\w+) step=(?<step>[\w-]+) level=(?<level>\w+) msg=(?<msg>.+?)\s*$/;

function toLogLine(e: BackendLogEntry): LogLine {
  const content = e.content ?? '';
  const marker = THEO_MARKER_RE.exec(content);
  if (marker?.groups) {
    const msg = unquote(marker.groups.msg);
    return {
      ts: e.timestamp ?? e.time ?? new Date().toISOString(),
      level: coerceLevel(marker.groups.level),
      msg,
      source: humanizePhase(marker.groups.phase),
    };
  }
  return {
    ts: e.timestamp ?? e.time ?? new Date().toISOString(),
    level: extractLevel(content),
    msg: content,
    source: e.step || e.stream,
  };
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    // Strip outer quotes AND undo the wrapper's sed escape (Layer 5):
    // build pipeline replays failure tail lines with `"` → `\"` and
    // `\` → `\\` so the marker regex survives. Reverse those here so
    // the user sees the real npm/cosign/buildkit error verbatim.
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return t;
}

function coerceLevel(raw: string): LogLevel {
  const l = raw.toLowerCase();
  if (l === 'warning') return 'warn';
  if (l === 'debug' || l === 'info' || l === 'warn' || l === 'error' || l === 'fatal') {
    return l;
  }
  return 'info';
}

// humanizePhase converts the canonical phase group ("clone" / "install"
// / "build" / "sign" / "deliver" / "other") into a capitalized display
// suitable for the LogViewer source column.
function humanizePhase(phase: string): string {
  if (!phase) return '';
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function extractLevel(content: string): LogLevel {
  const m = content.match(/level=(debug|info|warn|warning|error|fatal)/i);
  if (!m) return 'info';
  const lvl = m[1].toLowerCase();
  if (lvl === 'warning') return 'warn';
  return lvl as LogLevel;
}

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'cancelling']);

export interface UseBuildLogsResult {
  /** Historico + vivo, na ordem cronologica que o viewer espera. */
  lines: LogLine[];
  connected: boolean;
  error: boolean;
  /** Re-snapshot manual do historico. Preserva o stream vivo. */
  refresh: () => Promise<void>;
  refreshing: boolean;
  /** Limpa historico e buffer do stream. */
  clear: () => void;
}

export function useBuildLogs(buildId: string, paused: boolean): UseBuildLogsResult {
  const [historical, setHistorical] = useState<LogLine[]>([]);
  const [historicalLoading, setHistoricalLoading] = useState(true);
  const [historicalError, setHistoricalError] = useState<string | null>(null);
  // `refreshing` e distinto de `historicalLoading` — o primeiro e user-driven
  // (botao Refresh), o segundo e o ciclo de carga inicial.
  const [refreshing, setRefreshing] = useState(false);
  // O guard de click-storm precisa de um REF, nao do state.
  //
  // Defeito pre-existente que o teste de B-045 expos: `if (refreshing) return`
  // lia o valor do closure, que so muda no proximo render. Duas invocacoes no
  // MESMO tick — dois cliques rapidos, ou um clique que dispara dois handlers —
  // liam ambas `false` e disparavam duas requests. O state continua existindo
  // porque a UI precisa dele para desabilitar o botao; o ref e o que decide.
  const refreshInFlight = useRef(false);

  const { build } = useDeployment(buildId);
  const status = build ? normalizeBuildStatus(build.status) : 'queued';
  const isTerminal = TERMINAL_STATUSES.has(status);

  /**
   * Unico ponto que escreve o snapshot — e por isso o unico lugar onde o teto
   * precisa ser lembrado (B-016). Antes eram dois, e o segundo esqueceu.
   */
  /**
   * B-016 aplicou o teto FIFO ao snapshot; B-025 acrescentou o teto no REQUEST.
   *
   * Os dois precisam existir e nao sao redundantes. `capLogLines` protege a
   * MEMORIA e o DOM: e a ultima linha de defesa, e vale mesmo que o servidor
   * ignore o parametro. O `?limit=` protege a REDE: sem ele, um build de 200 mil
   * linhas baixava 200 mil e o cliente descartava 195 mil — trabalho de download
   * feito para ser jogado fora, no navegador de quem tem o build mais longo.
   */
  const aplicarSnapshot = useCallback((data: BackendLogsResponse | null) => {
    setHistorical(capLogLines((data?.entries ?? []).map(toLogLine)));
  }, []);

  // Carga inicial: no mount, ao trocar de build, e na transicao para terminal.
  //
  // LIVE bug 2026-06-06: abrindo a aba durante RUNNING, o Loki so tem as linhas
  // liberadas ate aquele instante. Quando o build termina e o Pod e reciclado,
  // os chunks restantes chegam ao Loki — mas a aba mantinha o snapshot parcial
  // para sempre porque a dependencia era so [id]. Incluir `isTerminal` refaz a
  // busca uma vez na transicao. Idempotente para um build ja terminal.
  useEffect(() => {
    if (!buildId) return;
    let cancelled = false;
    setHistoricalLoading(true);
    setHistoricalError(null);
    engineFetch<BackendLogsResponse>(
      `/api/v1/builds/${encodeURIComponent(buildId)}/logs?limit=${MAX_LOG_LINES}`,
    )
      .then((data) => {
        if (cancelled) return;
        aplicarSnapshot(data);
        setHistoricalLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHistoricalError(err instanceof Error ? err.message : 'Failed to load historical logs');
        setHistoricalLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [buildId, isTerminal, aplicarSnapshot]);

  // SSE apenas para builds nao-terminais. Terminal → path null → no-op.
  const streamPath =
    buildId && !isTerminal
      ? `/engine/api/v1/builds/${encodeURIComponent(buildId)}/logs/stream`
      : null;
  const stream = useLogStream(streamPath, { paused });

  const lines = useMemo<LogLine[]>(
    () => [...historical, ...stream.lines],
    [historical, stream.lines],
  );

  // Terminal: "conectado" significa que o historico carregou. Vivo: o SSE decide.
  const connected = isTerminal ? !historicalLoading && !historicalError : stream.connected;

  // B-175 — vive num ref e não em estado: ler isto não pode causar render.
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!buildId || refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    setHistoricalError(null);
    try {
      const data = await engineFetch<BackendLogsResponse>(
        `/api/v1/builds/${encodeURIComponent(buildId)}/logs?limit=${MAX_LOG_LINES}`,
      );
      // B-175 — nenhuma escrita depois da desmontagem. O efeito de carga inicial deste MESMO
      // arquivo guarda cada `set*` com um `cancelled` e limpa no unmount; este caminho não
      // guardava nada, e a assimetria era o defeito: quem sai da tela durante um refresh recebe
      // um aviso do React e, pior, o estado de um componente que não existe mais.
      if (montado.current) aplicarSnapshot(data);
    } catch (err: unknown) {
      if (montado.current) {
        setHistoricalError(err instanceof Error ? err.message : 'Failed to refresh logs');
      }
    } finally {
      refreshInFlight.current = false;
      if (montado.current) setRefreshing(false);
    }
  }, [buildId, aplicarSnapshot]);

  const clear = useCallback(() => {
    setHistorical([]);
    stream.clear();
  }, [stream]);

  return {
    lines,
    connected,
    error: Boolean(historicalError) || stream.error,
    refresh,
    refreshing,
    clear,
  };
}
