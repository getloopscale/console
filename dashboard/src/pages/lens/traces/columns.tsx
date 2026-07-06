import { Badge, Button, CopyButton, type DataTableColumn } from '@usetheo/ui';

import { formatDate, shortId } from '@/lib/format';
import { nsToIso } from '../traces';

/**
 * One traces-list row as the read API returns it. Declares only the fields the list
 * item carries today (M49/M52); latency/tokens/cost are proven on the wire by
 * `ExportTrace` (`src/lib/traces-export.ts`) but not yet surfaced as columns (M59 P1).
 */
export interface Trace {
  traceId: string;
  name?: string;
  status?: string;
  statusCode?: string;
  model?: string;
  startTimeUnixNano?: string;
}

/** Handles the column cells need from the orchestrating page (M59 P0 — verbatim extraction). */
export interface TracesColumnsOptions {
  selected: Set<string>;
  toggleSelected: (id: string) => void;
  onOpen: (id: string) => void;
}

/**
 * The traces `DataTable` column config: compare-select checkbox · timestamp · trace id
 * (short + copy) · name · model · status. Extracted verbatim from `traces.tsx` (M59 ADR D1)
 * so the page drops back under the 500-LoC budget; behavior-preserving in Phase 0.
 */
export function tracesColumns({ selected, toggleSelected, onOpen }: TracesColumnsOptions): DataTableColumn<Trace>[] {
  return [
    {
      key: 'compare-select',
      label: '',
      render: (row) => (
        <input
          type="checkbox"
          checked={selected.has(row.traceId)}
          onChange={() => toggleSelected(row.traceId)}
          aria-label={`Select ${row.traceId} for compare`}
          className="h-4 w-4 cursor-pointer"
        />
      ),
    },
    {
      key: 'timestamp',
      label: 'Time',
      render: (row) => {
        const iso = nsToIso(row.startTimeUnixNano);
        if (!iso) return <span className="text-muted-foreground">—</span>;
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpen(row.traceId)}
            title={row.traceId}
            aria-label={`Open ${row.traceId}`}
          >
            <span className="font-mono text-sm">{shortId(row.traceId)}</span>
          </Button>
          <CopyButton value={row.traceId} label="Copy trace id" />
        </div>
      ),
    },
    { key: 'name', label: 'Name', render: (row) => <span>{row.name ?? '—'}</span> },
    { key: 'model', label: 'Model', render: (row) => <span className="font-mono text-xs">{row.model ?? '—'}</span> },
    {
      key: 'status',
      label: 'Status',
      render: (row) => {
        const s = row.statusCode ?? row.status;
        if (!s) return <span>—</span>;
        return <Badge variant={s.toLowerCase() === 'error' ? 'destructive' : 'outline'}>{s}</Badge>;
      },
    },
  ];
}
