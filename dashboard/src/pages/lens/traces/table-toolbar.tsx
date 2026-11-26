import { Button } from '@getloopscale/ui';
import { Download, FlaskConical, GitCompareArrows } from 'lucide-react';

/**
 * M59 P1 — the traces-table toolbar. Two rows: (1) the bulk-action bar, shown ONLY when ≥1 row is
 * selected (selection-scoped: pairwise Compare + Clear selection); (2) the always-on filter-scoped
 * toolbar (density toggle + export the currently-filtered set). Presentation-only — the page owns the
 * state + callbacks. Blueprint §3 (row selection + a bulk-action bar).
 */
export interface TracesTableToolbarProps {
  density: 'comfortable' | 'compact';
  onToggleDensity: () => void;
  exporting: boolean;
  onExport: (format: 'csv' | 'json') => void;
  selectedCount: number;
  compareHref: string | undefined;
  onCompare: () => void;
  onClearSelection: () => void;
  /** M64 — turn the selected traces into a regression dataset (create dataset + add each). */
  onCreateDataset: () => void;
  creatingDataset: boolean;
}

export function TracesTableToolbar({
  density,
  onToggleDensity,
  exporting,
  onExport,
  selectedCount,
  compareHref,
  onCompare,
  onClearSelection,
  onCreateDataset,
  creatingDataset,
}: TracesTableToolbarProps) {
  return (
    <>
      {selectedCount > 0 ? (
        <div
          data-testid="bulk-action-bar"
          className="mb-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5"
        >
          <span className="text-xs font-medium">{selectedCount} selected</span>
          <div className="flex-1" />
          <Button
            variant="secondary"
            size="sm"
            disabled={compareHref === undefined}
            data-compare-href={compareHref}
            onClick={onCompare}
          >
            <GitCompareArrows className="mr-1 h-4 w-4" />
            Compare
          </Button>
          <Button variant="secondary" size="sm" disabled={creatingDataset} onClick={onCreateDataset}>
            <FlaskConical className="mr-1 h-4 w-4" />
            {creatingDataset ? 'Creating…' : 'Create regression dataset'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClearSelection} aria-label="Clear selection">
            Clear selection
          </Button>
        </div>
      ) : null}
      <div className="mb-2 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={density === 'compact'}
          onClick={onToggleDensity}
          aria-label="Toggle row density"
        >
          {density === 'compact' ? 'Comfortable' : 'Compact'}
        </Button>
        <Button variant="secondary" size="sm" disabled={exporting} onClick={() => onExport('csv')}>
          <Download className="mr-1 h-4 w-4" />
          Export CSV
        </Button>
        <Button variant="secondary" size="sm" disabled={exporting} onClick={() => onExport('json')}>
          <Download className="mr-1 h-4 w-4" />
          Export JSON
        </Button>
      </div>
    </>
  );
}
