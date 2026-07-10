import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox } from '@usetheo/ui';
import { Columns3 } from 'lucide-react';

import { TOGGLEABLE_COLUMNS, type ColumnState } from './view-encoding';

/**
 * M59 P3 — the column-visibility control (blueprint §3 / Arize Screen 1 "select tracing table
 * columns"). A button reveals a small panel of `Checkbox`es for the optional spine columns
 * (latency/tokens/cost); toggling writes the encoded `cols=` URL param via `onChange`, so the M52
 * saved view captures the choice for free (no schema change — ADR D4). Composed from `@usetheo/ui`
 * primitives + local state (no Radix menu) so it is deterministic under test.
 *
 * M98 (D-M5) — a11y for the hand-rolled popover: Escape closes it (and returns focus to the trigger),
 * an outside click/tap closes it, and opening moves focus into the panel. `aria-controls`/`role=dialog`
 * wire the trigger to the panel for assistive tech.
 */
export function ColumnsToggle({
  state,
  onChange,
}: {
  state: ColumnState;
  onChange: (next: ColumnState) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    // Move focus into the panel so keyboard users land on the first control.
    panelRef.current?.querySelector<HTMLElement>('input,[role="checkbox"],button')?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const toggle = (key: string) =>
    onChange({ ...state, visibility: { ...state.visibility, [key]: !(state.visibility[key] ?? true) } });

  return (
    <div className="relative" ref={rootRef}>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="columns-panel"
        aria-label="Choose columns"
        onClick={() => setOpen((o) => !o)}
      >
        <Columns3 className="mr-1 h-4 w-4" />
        Columns
      </Button>
      {open ? (
        <div
          ref={panelRef}
          id="columns-panel"
          role="dialog"
          aria-label="Choose columns"
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
