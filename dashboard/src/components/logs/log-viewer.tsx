import { useEffect, useRef, useState, memo} from 'react';
import { Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import { Badge, Button, Input } from '@usetheo/ui';
import type { LogLine, LogLevel } from '@/lib/api/types';
import { parseAnsi } from '@/components/logs/ansi';

interface LogViewerProps {
  lines: LogLine[];
  connected: boolean;
  error: boolean;
  paused: boolean;
  onTogglePause: () => void;
  onClear: () => void;
  // J-17 pattern #5 canonical (lessons-learned 2026-06-06):
  // REST + SSE coexistem; toda página com SSE expõe Refresh manual button.
  // Optional para back-compat — sem props o botão simplesmente não renderiza.
  onRefresh?: () => void;
  refreshing?: boolean;
  // J-19 T1.3 R3: lines dropped by the FIFO maxLines cap. Optional for
  // backward compat — absent or 0 hides the indicator.
  droppedCount?: number;
}

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: 'text-muted-foreground',
  info: 'text-foreground',
  warn: 'text-warning',
  error: 'text-destructive',
  fatal: 'text-destructive',
};

const LEVEL_BADGE: Record<
  LogLevel,
  'default' | 'destructive' | 'success' | 'warning' | 'primary' | 'accent' | 'outline'
> = {
  debug: 'outline',
  info: 'default',
  warn: 'warning',
  error: 'destructive',
  fatal: 'destructive',
};

const LEVELS: { value: 'all' | LogLevel; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

/**
 * LogViewer — Plan v1.0 T1.3 composite.
 *
 * Renders a streaming log buffer. Filter by severity, search by substring,
 * auto-scroll to bottom (disable on user scroll-up — re-enable when user
 * scrolls back to bottom). Pause/resume + clear controls in toolbar.
 *
 * Designed to render thousands of lines; uses CSS overflow-y-auto rather
 * than virtual scrolling (acceptable up to ~5000 lines; for larger streams
 * we'd need react-virtual — deferred).
 */
/**
 * Uma linha do log.
 *
 * B-025 — extraida e MEMOIZADA porque `parseAnsi` corre por linha no render, e
 * antes disso o `.map` inteiro re-executava a cada tecla na busca ou troca de
 * severidade. Com ate 5.000 linhas em memoria (o teto de B-016), digitar no
 * filtro re-parseava ANSI de todas elas a cada caractere.
 *
 * `React.memo` e explicito, e nao deixado para o React Compiler: o compiler
 * memoiza dentro do escopo de um componente, e o custo aqui estava num `.map`
 * do componente PAI — cada iteracao recriava o no e re-chamava `parseAnsi`.
 * Dar a linha o seu proprio componente e o que cria o ponto de memoizacao.
 *
 * Isto NAO e virtualizacao: o DOM continua com um no por linha, e B-025 segue
 * aberto para isso. E a metade barata e sem risco da remediacao — a outra
 * metade muda o permalink por hash e o auto-scroll, que nao tem e2e cobrindo.
 */
const LogLineRow = memo(function LogLineRow({ line, index }: { line: LogLine; index: number }) {
  return (
    <div
      data-line-index={index}
      onClick={() => {
        // J-19 T2.1 (R5): permalink — clicking a line sets the URL hash
        // so a line is shareable/deep-linkable.
        window.location.hash = `#L${String(index)}`;
      }}
      className="flex items-start gap-3 border-b border-border/30 px-4 py-1.5 cursor-pointer"
    >
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {line.ts.slice(11, 19)}
      </span>
      <Badge variant={LEVEL_BADGE[line.level]} className="shrink-0 text-label uppercase">
        {line.level}
      </Badge>
      {line.source && (
        <Badge variant="outline" className="shrink-0 text-label">
          {line.source}
        </Badge>
      )}
      <span className={`flex-1 break-all ${LEVEL_COLOR[line.level]}`}>
        {parseAnsi(line.msg)}
      </span>
    </div>
  );
});

export function LogViewer({
  lines,
  connected,
  error,
  paused,
  onTogglePause,
  onClear,
  onRefresh,
  refreshing = false,
  droppedCount = 0,
}: LogViewerProps) {
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | LogLevel>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Auto-scroll on new lines — but only when user hasn't scrolled up
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !autoScrollRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  // J-19 T2.1 (R5) — per-line permalink READ side. On mount, parse the hash;
  // if `#L<n>` matches a valid line index, scroll that line into view and
  // disable auto-scroll so the target stays put (the click WRITE side sets the
  // hash below). Index-based for v0.1; if FIFO drops happen between click and
  // reload the target may shift — the droppedCount indicator (R3) makes that
  // discoverable. Runs once after mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const m = window.location.hash.match(/^#L(\d+)$/);
    if (!m || m[1] === undefined) return;
    const idx = Number.parseInt(m[1], 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= lines.length) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-line-index="${String(idx)}"]`);
    el?.scrollIntoView({ block: 'center' });
    autoScrollRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    autoScrollRef.current = atBottom;
  };

  const filtered = lines.filter((l) => {
    if (levelFilter !== 'all' && l.level !== levelFilter) return false;
    if (search && !l.msg.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // J-19 T1.4 (R4): the truly-empty "No log lines yet" message is delayed 3s so
  // a freshly-connected stream that simply hasn't emitted yet doesn't flash an
  // alarming empty state. The timer is gated on `connected` — disconnecting (or
  // lines arriving) cancels it (EC7), so a disconnected stream never shows it.
  const noLinesAtAll = lines.length === 0;
  const [showEmptyState, setShowEmptyState] = useState(false);
  useEffect(() => {
    if (noLinesAtAll && connected) {
      const t = setTimeout(() => setShowEmptyState(true), 3000);
      return () => clearTimeout(t);
    }
    setShowEmptyState(false);
    return undefined;
  }, [noLinesAtAll, connected]);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2">
        <Input
          type="search"
          placeholder="Search logs..."
          aria-label="Search log lines"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-48"
        />
        <div className="flex items-center gap-1" role="group" aria-label="Filter by level">
          {LEVELS.map((l) => (
            <Button
              key={l.value}
              size="sm"
              variant={levelFilter === l.value ? 'primary' : 'ghost'}
              onClick={() => setLevelFilter(l.value)}
            >
              {l.label}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge
            variant={connected ? 'success' : error ? 'destructive' : 'outline'}
            className="text-label uppercase"
          >
            {error ? 'Disconnected' : connected ? 'Live' : 'Connecting…'}
          </Badge>
          {/* Refresh — explicit re-fetch of historical lines via REST.
              SSE keeps streaming live lines in background; this button
              forces a fresh GET /logs to re-snapshot retained chunks
              (useful after backfill OR after build transitioned terminal
              and the workflow Pod was reaped). Per J-17 pattern #5
              canonical (lessons-learned 2026-06-06): REST + SSE coexistem;
              Refresh manual obrigatório. Icon spins durante isFetching;
              disabled prevents click storms. */}
          {onRefresh && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh log buffer"
              title="Refresh"
            >
              <RefreshCw
                className={`size-4 ${refreshing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onTogglePause}
            aria-label={paused ? 'Resume log stream' : 'Pause log stream'}
          >
            {paused ? (
              <Play className="size-4" aria-hidden="true" />
            ) : (
              <Pause className="size-4" aria-hidden="true" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            aria-label="Clear log buffer"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {droppedCount > 0 && (
        <div
          role="status"
          className="border-b border-border/60 bg-warning/10 px-4 py-1.5 text-label text-warning-foreground"
        >
          {droppedCount} older line{droppedCount === 1 ? '' : 's'} dropped from buffer
        </div>
      )}

      {/* Log lines */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-surface-1 font-mono text-label"
      >
        {filtered.length === 0 ? (
          // T0.2 D4 — empty state with what/why/action context. The truly-empty
          // case is delayed 3s (R4); the filtered-to-empty case shows immediately.
          noLinesAtAll ? (
            showEmptyState ? (
              <div className="px-4 py-12 text-center text-muted-foreground">
                No log lines yet. Logs stream here as your app runs — trigger a request or wait for the next event.
              </div>
            ) : null
          ) : (
            <div className="px-4 py-12 text-center text-muted-foreground">
              No lines match your filter. Clear search or change severity to see more lines.
            </div>
          )
        ) : (
          filtered.map((line, i) => (
            <LogLineRow key={`${line.ts}-${i}`} line={line} index={i} />
          ))
        )}
      </div>
    </div>
  );
}
