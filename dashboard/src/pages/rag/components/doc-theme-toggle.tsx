import { Monitor, Sun } from 'lucide-react';
import { useDocTheme } from '@/hooks/rag/use-doc-theme';

/**
 * DocThemeToggle — segmented [Sistema | Branco] control for the wiki page content theme.
 * Reads/writes the global document-theme preference (localStorage), so both the reader and
 * the editor stay in sync and every page opens on the chosen surface.
 */
export function DocThemeToggle() {
  const [theme, setTheme] = useDocTheme();
  return (
    <div
      className="inline-flex rounded-md border border-border p-0.5 text-sm"
      role="group"
      aria-label="Document theme"
      data-testid="doc-theme-toggle"
    >
      <button
        type="button"
        aria-pressed={theme === 'system'}
        onClick={() => setTheme('system')}
        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 ${
          theme === 'system' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <Monitor className="h-3.5 w-3.5" aria-hidden="true" /> System
      </button>
      <button
        type="button"
        aria-pressed={theme === 'white'}
        onClick={() => setTheme('white')}
        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 ${
          theme === 'white' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <Sun className="h-3.5 w-3.5" aria-hidden="true" /> White
      </button>
    </div>
  );
}
