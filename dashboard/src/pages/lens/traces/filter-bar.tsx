import { useState } from 'react';
import { Badge, Button, Input, Select } from '@usetheo/ui';
import { X } from 'lucide-react';

import {
  applyFilter,
  clearFilter,
  columnValueOptions,
  filterColumns,
  filtersToChips,
  type TraceFilters,
} from './filter-model';

/**
 * M59 P2 T2.2 — the chip-filter builder (blueprint §3; ADR D2/D3). An **Add-filter** column `Select`
 * (column → operator → value) appends a filter; applied filters render as removable `Badge` chips
 * (× drops the exact URL param); a count `Badge` shows the active count. Composed from `@usetheo/ui`
 * `Select`/`Input`/`Badge` — NOT `Popover` (which `@usetheo/ui` does not export — ADR D3 / parsimony
 * rung-4). It writes the SAME `nuqs` params via `onApply`, so `buildTraceQuery` + the M49 BFF whitelist
 * are unchanged. `Select` (not a Radix menu) so the picker is deterministic under test (combobox/option).
 */
export function FilterBar({
  filters,
  onApply,
}: {
  filters: TraceFilters;
  onApply: (partial: Partial<TraceFilters>) => void;
}) {
  const chips = filtersToChips(filters);
  const [column, setColumn] = useState('');
  const [draft, setDraft] = useState('');
  const editing = column ? (filterColumns().find((c) => c.id === column) ?? null) : null;

  const pickColumn = (id: string) => {
    setColumn(id);
    const opts = columnValueOptions(id);
    setDraft(opts ? opts[0] : '');
  };

  const apply = () => {
    if (!editing || draft.trim() === '') return;
    onApply(applyFilter(editing.id, draft.trim()));
    setColumn('');
    setDraft('');
  };

  const cancel = () => {
    setColumn('');
    setDraft('');
  };

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
      <Select value={column} onValueChange={pickColumn}>
        <Select.Trigger className="w-[150px]" aria-label="Add filter">
          <Select.Value placeholder="Add filter" />
        </Select.Trigger>
        <Select.Content>
          {filterColumns().map((c) => (
            <Select.Item key={c.id} value={c.id}>
              <span className="capitalize">{c.column}</span> <span className="text-muted-foreground">{c.operator}</span>
            </Select.Item>
          ))}
        </Select.Content>
      </Select>

      {chips.length > 0 ? (
        <Badge variant="outline" data-testid="filter-count">
          {chips.length}
        </Badge>
      ) : null}

      {editing ? (
        <div className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1" data-testid="filter-editor">
          <span className="text-xs text-muted-foreground">
            <span className="capitalize">{editing.column}</span> {editing.operator}
          </span>
          {columnValueOptions(editing.id) ? (
            <Select value={draft} onValueChange={setDraft}>
              <Select.Trigger className="h-7 w-[120px]" aria-label={`${editing.column} value`}>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {columnValueOptions(editing.id)!.map((o) => (
                  <Select.Item key={o} value={o}>
                    {o}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          ) : (
            <Input
              className="h-7 w-[130px]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && apply()}
              placeholder="value"
              aria-label={`${editing.column} value`}
              autoFocus
            />
          )}
          <Button size="sm" variant="ghost" onClick={apply} aria-label="Apply filter">
            Apply
          </Button>
          <Button size="sm" variant="ghost" onClick={cancel} aria-label="Cancel filter">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}

      {chips.map((chip) => (
        <Badge key={chip.id} variant="outline" className="gap-1" data-testid="filter-chip">
          <span>
            <span className="capitalize">{chip.column}</span> {chip.operator}{' '}
            <span className="font-medium">{chip.value}</span>
          </span>
          <button
            type="button"
            onClick={() => onApply(clearFilter(chip.id))}
            aria-label={`Remove ${chip.column} filter`}
            className="ml-0.5 rounded-sm hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}
