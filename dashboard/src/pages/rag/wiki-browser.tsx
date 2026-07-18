import { ChevronRight, FileText, Folder, House } from 'lucide-react';
import { Badge } from '@usetheo/ui';

import {
  breadcrumbSegments,
  deriveWikiEntries,
  leafName,
  prefixForCrumb,
  type WikiEntry,
} from './wiki-entries';

/**
 * WikiBrowser — the single folder-browser (master) for the wiki, replacing the
 * former folder-tree + flat-list pair. Shows the folders and pages directly under
 * `prefix`, breadcrumb-navigable, mirroring the Workspace browser so the two
 * surfaces share one spatial model. In `compact` mode it renders as the narrow rail
 * of the master-detail split (a page/editor is open on the right).
 */
export function WikiBrowser({
  pages,
  prefix,
  onNavigate,
  onOpenPage,
  activePageID,
  compact = false,
}: {
  readonly pages: readonly WikiEntry[];
  readonly prefix: string;
  readonly onNavigate: (prefix: string) => void;
  readonly onOpenPage: (id: string) => void;
  readonly activePageID?: string | null;
  readonly compact?: boolean;
}) {
  const { folders, pages: leaves } = deriveWikiEntries(pages, prefix);
  const segs = breadcrumbSegments(prefix);
  const empty = folders.length === 0 && leaves.length === 0;

  return (
    <div className="overflow-hidden rounded-md border border-border" data-testid="wiki-browser">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 border-b border-border px-2 py-1.5 text-sm" aria-label="Folder path">
        <button
          type="button"
          onClick={() => onNavigate('')}
          className="flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          aria-label="Wiki root"
        >
          <House className="h-3.5 w-3.5" />
          {!compact && <span>workspace</span>}
        </button>
        {segs.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <button
              type="button"
              onClick={() => onNavigate(prefixForCrumb(prefix, i))}
              className={`rounded px-1 py-0.5 hover:bg-muted/50 ${i === segs.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {seg}
            </button>
          </span>
        ))}
      </nav>

      <div role="list" className="max-h-[65vh] overflow-y-auto">
        {folders.map((f) => (
          <button
            key={`folder:${f}`}
            type="button"
            role="listitem"
            onClick={() => onNavigate(prefix + f + '/')}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
            aria-label={`Open folder ${f}`}
          >
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{f}</span>
          </button>
        ))}
        {leaves.map((p) => {
          const active = p.id === activePageID;
          return (
            <button
              key={p.id}
              type="button"
              role="listitem"
              aria-current={active ? 'true' : undefined}
              onClick={() => onOpenPage(p.id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 ${active ? 'bg-muted' : ''}`}
              aria-label={`Open ${p.name}`}
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{leafName(p.name)}</span>
              {!compact && p.type && p.type !== 'concept' ? (
                <Badge variant="outline" className="ml-auto shrink-0">
                  {p.type}
                </Badge>
              ) : null}
              {!compact && p.status !== 'ready' ? (
                <Badge variant="outline" className={p.type && p.type !== 'concept' ? 'shrink-0' : 'ml-auto shrink-0'}>
                  {p.status}
                </Badge>
              ) : null}
            </button>
          );
        })}
        {empty ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">This folder is empty.</div>
        ) : null}
      </div>
    </div>
  );
}
