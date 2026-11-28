import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { FileText } from 'lucide-react';
import { Input } from '@getloopscale/ui';
import { AppModal } from '@/components/ui/app-modal';
import { leafName, WIKI_FOLDER_MARKER, type WikiEntry } from './wiki-entries';

/** Folder (path prefix, no trailing slash) a page lives in — shown as a dim hint in results. */
function folderOf(name: string): string {
  const i = name.lastIndexOf('/');
  return i === -1 ? '' : name.slice(0, i);
}

/** Case-insensitive filter over the full path, hiding the hidden `.keep` folder markers. */
function filterPages(pages: readonly WikiEntry[], query: string): WikiEntry[] {
  const q = query.trim().toLowerCase();
  const visible = pages.filter((p) => !p.name.endsWith(`/${WIKI_FOLDER_MARKER}`) && p.name !== WIKI_FOLDER_MARKER);
  const matched = q === '' ? visible : visible.filter((p) => p.name.toLowerCase().includes(q));
  return matched.slice().sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * WikiSearch — a centered, friendly search modal for wiki pages (replaces the lateral command
 * palette on `/rag/wiki`). Type to filter by path; ↑/↓ to move, Enter to open, Esc to close.
 * Built on the standardized `AppModal` (Rule: no lateral panels).
 */
export function WikiSearch({
  open,
  onClose,
  pages,
  onSelect,
  readFailed = false,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly pages: readonly WikiEntry[];
  readonly onSelect: (id: string) => void;
  /**
   * B-238 — a leitura das páginas falhou.
   *
   * Este componente recebe `pages` pronto, e quem o monta transformava um erro em lista vazia
   * (`pagesQuery.data?.items ?? []`). O resultado é que uma busca durante uma falha de rede dizia
   * "No matching pages" — a afirmação mais confiante possível sobre um acervo que ninguém leu.
   */
  readonly readFailed?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => filterPages(pages, query), [pages, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);
  useEffect(() => setActive(0), [query]);

  const choose = (i: number) => {
    const r = results[i];
    if (r) {
      onSelect(r.id);
      onClose();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    }
  };

  return (
    <AppModal open={open} onClose={onClose} size="lg" title="Search wiki" hideCloseButton>
      <div className="flex min-h-0 flex-col gap-2">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search pages…"
          aria-label="Search wiki pages"
          data-testid="wiki-search-input"
        />
        <div className="min-h-0 max-h-[50vh] overflow-y-auto" role="listbox" aria-label="Search results">
          {results.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">
              {readFailed
                ? 'The page list could not be read, so this is not a search over the wiki — it is a search over nothing. Close and retry.'
                : 'No matching pages.'}
            </p>
          ) : (
            results.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
                aria-label={`Open ${p.name}`}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
                  i === active ? 'bg-muted' : ''
                }`}
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{leafName(p.name)}</span>
                {folderOf(p.name) ? (
                  <span className="ml-auto shrink-0 truncate font-mono text-xs text-muted-foreground">{folderOf(p.name)}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </AppModal>
  );
}
