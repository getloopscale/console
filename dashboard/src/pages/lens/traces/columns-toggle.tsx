import { useState } from 'react';
import { Button, Checkbox } from '@usetheo/ui';
import { Columns3 } from 'lucide-react';

import { TOGGLEABLE_COLUMNS, type ColumnState } from './view-encoding';

/**
 * M59 P3 — the column-visibility control (blueprint §3 / Arize Screen 1 "select tracing table
 * columns"). A button reveals a small panel of `Checkbox`es for the optional spine columns
 * (latency/tokens/cost); toggling writes the encoded `cols=` URL param via `onChange`, so the M52
 * saved view captures the choice for free (no schema change — ADR D4). Composed from `@usetheo/ui`
 * primitives + local state (no Radix menu) so it is deterministic under test.
 */
export function ColumnsToggle({
  state,
  onChange,
}: {
  state: ColumnState;
  onChange: (next: ColumnState) => void;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (key: string) =>
    onChange({ ...state, visibility: { ...state.visibility, [key]: !(state.visibility[key] ?? true) } });

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-label="Choose columns"
        onClick={() => setOpen((o) => !o)}
      >
        <Columns3 className="mr-1 h-4 w-4" />
        Columns
      </Button>
      {open ? (
        <div
          data-testid="columns-panel"
          className="absolute right-0 z-10 mt-1 flex flex-col gap-2 rounded-md border border-border bg-popover p-3 shadow-md"
        >
          {TOGGLEABLE_COLUMNS.map((key) => (
            <label key={key} className="flex items-center gap-2 text-xs capitalize">
              <Checkbox
                checked={state.visibility[key] ?? true}
                onCheckedChange={() => toggle(key)}
                aria-label={`Toggle ${key} column`}
              />
              {key}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
