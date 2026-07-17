import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react';

/**
 * WikiTree (KB2) — renders the OKF pages of a collection as a navigable folder tree,
 * derived from each page's `name` path (e.g. `tables/customers.md`). Replaces the plain
 * `<pre>` OKF-index dump: folders collapse/expand, page leaves open the reader. Pages with
 * no `/` in their name render at the root under an implicit "Ungrouped" bucket (kept last).
 */

export interface WikiTreePage {
  readonly id: string;
  readonly name: string;
  readonly type?: string;
  readonly status?: string;
}

interface FolderNode {
  readonly folders: Map<string, FolderNode>;
  readonly pages: WikiTreePage[];
}

function newFolder(): FolderNode {
  return { folders: new Map(), pages: [] };
}

const UNGROUPED = 'Ungrouped';

/** Build a folder tree from page paths. Deterministic: folders + pages sorted by name. */
export function buildTree(pages: readonly WikiTreePage[]): FolderNode {
  const root = newFolder();
  for (const page of pages) {
    const segments = page.name.split('/').filter((s) => s !== '');
    if (segments.length <= 1) {
      // no folder → bucket under Ungrouped so the root stays folder-only
      let bucket = root.folders.get(UNGROUPED);
      if (bucket === undefined) {
        bucket = newFolder();
        root.folders.set(UNGROUPED, bucket);
      }
      bucket.pages.push(page);
      continue;
    }
    let node = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i];
      let next = node.folders.get(seg);
      if (next === undefined) {
        next = newFolder();
        node.folders.set(seg, next);
      }
      node = next;
    }
    node.pages.push(page);
  }
  return root;
}

function sortedFolderNames(node: FolderNode): string[] {
  return [...node.folders.keys()].sort((a, b) => {
    if (a === UNGROUPED) return 1; // Ungrouped always last
    if (b === UNGROUPED) return -1;
    return a.localeCompare(b);
  });
}

function leafName(path: string): string {
  const parts = path.split('/').filter((s) => s !== '');
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function FolderRow({
  name,
  node,
  depth,
  onOpen,
}: {
  name: string;
  node: FolderNode;
  depth: number;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-sm font-medium text-foreground hover:bg-muted/50"
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        aria-expanded={open}
        aria-label={`Folder ${name}`}
        role="treeitem"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
      </button>
      {open ? (
        <div role="group">
          <TreeLevel node={node} depth={depth + 1} onOpen={onOpen} />
        </div>
      ) : null}
    </div>
  );
}

function TreeLevel({ node, depth, onOpen }: { node: FolderNode; depth: number; onOpen: (id: string) => void }) {
  const folders = sortedFolderNames(node);
  const pages = [...node.pages].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div>
      {folders.map((f) => (
        <FolderRow key={f} name={f} node={node.folders.get(f) as FolderNode} depth={depth} onOpen={onOpen} />
      ))}
      {pages.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onOpen(p.id)}
          className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          style={{ paddingLeft: `${depth * 12 + 20}px` }}
          aria-label={`Open ${p.name}`}
          role="treeitem"
        >
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{leafName(p.name)}</span>
        </button>
      ))}
    </div>
  );
}

export function WikiTree({ pages, onOpen }: { pages: readonly WikiTreePage[]; onOpen: (id: string) => void }) {
  const root = useMemo(() => buildTree(pages), [pages]);
  if (pages.length === 0) return null;
  return (
    <div className="text-sm" data-testid="wiki-tree" role="tree" aria-label="Wiki pages">
      <TreeLevel node={root} depth={0} onOpen={onOpen} />
    </div>
  );
}
