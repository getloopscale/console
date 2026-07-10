import { useState } from 'react';
import { Badge, Button, Input, Select } from '@usetheo/ui';
import { X } from 'lucide-react';

import {
  applyFilter,
  clearFilter,
  columnValueOptions,
  displayChipValue,
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
  attributeKeys = [],
}: {
  filters: TraceFilters;
  onApply: (partial: Partial<TraceFilters>) => void;
  /** M92 — discovered attribute keys to suggest in the `attribute` facet control (may be empty). */
  attributeKeys?: string[];
}) {
  const chips = filtersToChips(filters);
  const [column, setColumn] = useState('');
  const [draft, setDraft] = useState('');
  // M92 — the `attribute` column composes a key + value into an `attr:key=value` clause.
  const [attrKey, setAttrKey] = useState('');
  const [attrValue, setAttrValue] = useState('');
  const editing = column ? (filterColumns().find((c) => c.id === column) ?? null) : null;

  const pickColumn = (id: string) => {
    setColumn(id);
    setAttrKey('');
    setAttrValue('');
    const opts = columnValueOptions(id);
    setDraft(opts ? opts[0] : '');
  };

  const apply = () => {
    if (!editing) return;
    if (editing.id === 'attr') {
      if (attrKey.trim() === '' || attrValue.trim() === '') return;
      onApply(applyFilter('attr', `${attrKey.trim()}=${attrValue.trim()}`));
    } else {
      if (draft.trim() === '') return;
      onApply(applyFilter(editing.id, draft.trim()));
    }
    cancel();
  };

  const cancel = () => {
    setColumn('');
    setDraft('');
    setAttrKey('');
    setAttrValue('');
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
          {editing.id === 'attr' ? (
            <>
              {/* M92 — a key input with native <datalist> suggestions from facet discovery + a value input.
                  A free-text key stays usable when discovery is empty/unavailable (graceful degradation). */}
              <Input
                className="h-7 w-[150px]"
                list="attr-key-suggestions"
                value={attrKey}
                onChange={(e) => setAttrKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && apply()}
                placeholder="attribute key"
                aria-label="attribute key"
                autoFocus
              />
              <datalist id="attr-key-suggestions">
                {attributeKeys.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
              <span className="text-xs text-muted-foreground">=</span>
              <Input
                className="h-7 w-[120px]"
                value={attrValue}
                onChange={(e) => setAttrValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && apply()}
                placeholder="value"
                aria-label="attribute value"
              />
            </>
          ) : columnValueOptions(editing.id) ? (
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
            <span className="font-medium">{displayChipValue(chip)}</span>
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
