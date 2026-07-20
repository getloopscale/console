import { Badge, Button, Checkbox, CopyButton, StatusDot, type DataTableColumn } from '@usetheo/ui';
import { Sparkles } from 'lucide-react';

import { formatCost, formatDate, formatDuration, formatTokens, shortId } from '@/lib/format';
import { isSpanError } from '@/lib/span-status';
import { nsToIso } from '../traces';

/**
 * One traces-list row as the read API returns it. Declares the fields the list item carries today —
 * the M49/M52 identity/status fields PLUS the latency/tokens/cost fields proven on the wire by
 * `ExportTrace` (`src/lib/traces-export.ts` — the read API's `traceListItemSchema`) and surfaced as
 * columns in M59 P1. `input/output preview` and `tags` are NOT on the list wire (see the plan's
 * Unresolved Questions Q1/Q2) — no column fabricates them.
 */
export interface Trace {
  traceId: string;
  name?: string;
  status?: string;
  statusCode?: string;
  model?: string;
  startTimeUnixNano?: string;
  // M59 P1 — consensus-spine numeric fields (all optional; absent → em-dash, never fabricated).
  durationMs?: number;
  costUsd?: number;
  totalTokens?: number;
  sessionId?: string;
  // M78 — per-trace count of machine evaluations (from the list read's `evaluationsCount`, O(1) subquery;
  // omitted when 0). Makes scored traces findable in the list without opening each one.
  evaluationsCount?: number;
}

/** Handles the column cells need from the orchestrating page (M59 P0/P1 + M61 onAsk). */
export interface TracesColumnsOptions {
  selected: Set<string>;
  toggleSelected: (id: string) => void;
  onOpen: (id: string) => void;
  /** M61 — dock the Ask copilot to this trace (navigates to /observability/ask?traceId=…, no UUID entry). */
  onAsk: (id: string) => void;
}

const EMDASH = <span className="text-muted-foreground">—</span>;

/**
 * The traces `DataTable` column config (M59 P1 — the consensus spine, blueprint §3 + Arize Screen 1):
 * compare `Checkbox` · timestamp · trace id (short + copy) · name · model · **latency · tokens · cost**
 * · status (`StatusDot` + `Badge`). Numeric cells format via `format.ts` (M57) and render `—` when the
 * field is absent on the wire — no fabricated value (R2).
 */
export function tracesColumns({ selected, toggleSelected, onOpen, onAsk }: TracesColumnsOptions): DataTableColumn<Trace>[] {
  return [
    {
      key: 'compare-select',
      label: '',
      render: (row) => (
        <Checkbox
          checked={selected.has(row.traceId)}
          onCheckedChange={() => toggleSelected(row.traceId)}
          aria-label={`Select ${row.traceId} for compare`}
        />
      ),
    },
    {
      key: 'timestamp',
      label: 'Time',
      render: (row) => {
        const iso = nsToIso(row.startTimeUnixNano);
        if (!iso) return EMDASH;
        return (
          <span
            className="text-xs whitespace-nowrap text-muted-foreground"
            title={formatDate(iso, 'datetime')}
          >
            {formatDate(iso, 'relative')}
          </span>
        );
      },
    },
    {
      key: 'traceId',
      label: 'Trace',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onOpen(row.traceId)}
            title={row.traceId}
            aria-label={`Open ${row.traceId}`}
            className="font-mono text-sm hover:underline"
          >
            {shortId(row.traceId)}
          </button>
          <CopyButton value={row.traceId} label="Copy trace id" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onAsk(row.traceId)}
            title="Ask the copilot about this trace"
            aria-label={`Ask copilot about ${row.traceId}`}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
    { key: 'name', label: 'Name', render: (row) => <span>{row.name ?? '—'}</span> },
    { key: 'model', label: 'Model', render: (row) => <span className="font-mono text-xs">{row.model ?? '—'}</span> },
    {
      // M53 / theo-lens#74: honest label — this is the trace wall-clock (for an interaction that is
      // the whole session, minutes), NOT request latency. The `latency` key is kept so saved views /
      // sort params stay stable; only the user-facing label changes to "Duration".
      key: 'latency',
      label: 'Duration',
      render: (row) =>
        row.durationMs != null ? (
          <span className="text-xs whitespace-nowrap tabular-nums">{formatDuration(row.durationMs)}</span>
        ) : (
          EMDASH
        ),
    },
    {
      key: 'tokens',
      label: 'Tokens',
      render: (row) =>
        row.totalTokens != null ? (
          <span className="text-xs tabular-nums">{formatTokens(row.totalTokens)}</span>
        ) : (
          EMDASH
        ),
    },
    {
      key: 'cost',
      label: 'Cost',
      render: (row) =>
        row.costUsd != null ? (
          <span className="text-xs tabular-nums">{formatCost(row.costUsd)}</span>
        ) : (
          EMDASH
        ),
    },
    {
      key: 'evals',
      label: 'Evals',
      // A count of machine evaluations on the trace (not a pass/fail verdict). Absent/0 → em-dash, never a
      // fabricated 0; the per-span Evaluations section carries the actual scores.
      render: (row) =>
        row.evaluationsCount != null && row.evaluationsCount > 0 ? (
          <Badge variant="outline" aria-label={`${row.evaluationsCount} evaluations`}>{row.evaluationsCount}</Badge>
        ) : (
          EMDASH
        ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => {
        const s = row.statusCode ?? row.status;
        if (!s) return EMDASH;
        // Honest error flag over the OTLP tokens (`2`/`ERROR`/`STATUS_CODE_ERROR`) via the shared
        // predicate, PLUS the lowercase string form — the previous `=== 'error'` missed `2` /
        // `STATUS_CODE_ERROR` and silently showed an error trace as non-error (#176 family).
        const isError = isSpanError(s) || s.toLowerCase() === 'error';
        return (
          <span className="inline-flex items-center gap-1.5">
            <StatusDot status={isError ? 'failed' : 'live'} size="xs" />
            <Badge variant={isError ? 'destructive' : 'outline'}>{s}</Badge>
          </span>
        );
      },
    },
  ];
}
