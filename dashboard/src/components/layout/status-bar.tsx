import { SystemStatusIndicator } from './system-status-indicator';

/**
 * The footer of the shell: one thin line in the mono typeface with the state of the platform. It
 * stays in view on every page, where the sidebar's foot scrolled away on a short window.
 */
export function StatusBar() {
  return (
    <footer
      aria-label="Platform status"
      className="flex h-7 shrink-0 items-center justify-end border-t border-border bg-card px-3 font-mono text-[11px] tabular-nums text-muted-foreground"
    >
      <SystemStatusIndicator />
    </footer>
  );
}
