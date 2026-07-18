import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, FolderPlus, Plus } from 'lucide-react';
import { Badge, Button, Card, CommandPalette, EmptyState, Input, PageShell, Select, Skeleton } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import { MarkdownView } from '@/components/common/markdown-view';
import { KbEditor } from '@/components/rag/kb-editor';
import { applyTemplate, WIKI_TEMPLATES } from './wiki-templates';
import { toCommandItems } from './wiki-command';
import { WikiBrowser } from './wiki-browser';
import { WIKI_FOLDER_MARKER, type WikiEntry } from './wiki-entries';
import { NewFolderDialog } from '../new-folder-dialog';

import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * Open Wiki — /rag/wiki. A single folder-browser (like /workspaces) over per-tenant
 * markdown pages: navigate folders, create folders + pages, and read/edit a page in a
 * master-detail split (the list collapses to a rail while a page or the new-page editor
 * is open). A wiki page is a source_type='wiki' theo-rag document whose OKF `name` is its
 * path; a "folder" is a path prefix (empty folders carry a hidden `.keep` marker).
 */

interface Collection {
  id: string;
  name?: string;
}
interface OkfMeta {
  type?: string;
  title?: string;
  description?: string;
  tags?: string[];
  timestamp?: string;
}
type WikiPage = WikiEntry & { updated_at?: string };

/** Folder prefix (with trailing slash) that a page path lives in ('api/auth.md' → 'api/'). */
function folderOf(name: string): string {
  const i = name.lastIndexOf('/');
  return i === -1 ? '' : name.slice(0, i + 1);
}

/**
 * Build an OKF (Open Knowledge Format) frontmatter fence from the structured fields and
 * prepend it to the body. The data-plane parser (theo-rag) splits this back into
 * `documents.metadata.okf` + the stripped body. Only emits a fence when a non-default
 * field is set, so a plain page stays plain.
 */
export function withOkfFrontmatter(body: string, type: string, tags: string, description: string): string {
  const tagList = tags
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '');
  const t = type.trim();
  const hasOkf = (t !== '' && t !== 'concept') || tagList.length > 0 || description.trim() !== '';
  if (!hasOkf) return body;
  const lines = ['---', `type: ${t === '' ? 'concept' : t}`];
  if (description.trim() !== '') lines.push(`description: ${description.trim()}`);
  if (tagList.length > 0) lines.push(`tags: [${tagList.join(', ')}]`);
  lines.push('---', '');
  return lines.join('\n') + body;
}

export function RagWikiPage() {
  useRequireAuth();
  const queryClient = useQueryClient();
  const [collectionID, setCollectionID] = useState('');
  const [prefix, setPrefix] = useState('');
  const [openPageID, setOpenPageID] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // New-folder modal state.
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');

  // KB14 — Cmd/Ctrl+K opens the wiki page palette (jump to any page).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const collectionsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/collections'] as const,
    queryFn: () => cloudFetch<{ items: Collection[] }>('/v1/dashboard/rag/collections'),
  });

  const pagesQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/wiki/pages', collectionID] as const,
    queryFn: () =>
      cloudFetch<{ items: WikiPage[] }>(`/v1/dashboard/rag/wiki/pages?collection_id=${encodeURIComponent(collectionID)}`),
    enabled: collectionID !== '',
  });

  const collections = collectionsQuery.data?.items ?? [];
  const pages = useMemo(() => pagesQuery.data?.items ?? [], [pagesQuery.data]);

  const invalidatePages = () =>
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/rag/wiki/pages', collectionID] });

  // New folder = a hidden `.keep` marker page under the current prefix (Workspace parity).
  const folderCreate = useMutation({
    mutationFn: () =>
      cloudFetch('/v1/dashboard/rag/wiki/pages', {
        method: 'POST',
        body: JSON.stringify({
          collection_id: collectionID,
          name: `${prefix}${folderName.trim()}/${WIKI_FOLDER_MARKER}`,
          content: 'folder marker',
        }),
      }),
    onSuccess: () => {
      setFolderOpen(false);
      setFolderName('');
      invalidatePages();
    },
  });

  const detailOpen = creating || openPageID !== null;
  const openNewPage = () => {
    setOpenPageID(null);
    setCreating(true);
  };
  const openExisting = (id: string) => {
    setCreating(false);
    setOpenPageID(id);
  };

  return (
    <PageShell title="Wiki" description="Folders and markdown pages your team can read, edit, and Ask over.">
      {/* KB14 — Cmd+K page palette. Selecting a page navigates the rail to its folder. */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={toCommandItems(pages)}
        onSelect={(id) => {
          const pg = pages.find((p) => p.id === id);
          if (pg) setPrefix(folderOf(pg.name));
          openExisting(id);
          setPaletteOpen(false);
        }}
        placeholder="Search wiki pages…"
        emptyMessage={pages.length === 0 ? 'Select a collection to search its pages.' : 'No matching pages.'}
      />

      <NewFolderDialog
        open={folderOpen}
        prefix={prefix}
        name={folderName}
        error={folderCreate.isError ? 'Could not create the folder. Try again.' : null}
        creating={folderCreate.isPending}
        onNameChange={setFolderName}
        onCreate={() => {
          if (folderName.trim() !== '' && !folderName.includes('/')) folderCreate.mutate();
        }}
        onClose={() => setFolderOpen(false)}
      />

      <div className="space-y-4">
        {/* Toolbar: collection picker + actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={collectionID} onValueChange={setCollectionID}>
            <Select.Trigger className="w-56" aria-label="Collection">
              <Select.Value placeholder="Select a collection…" />
            </Select.Trigger>
            <Select.Content>
              {collections.map((c) => (
                <Select.Item key={c.id} value={c.id}>
                  {c.name ?? c.id}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={collectionID === ''}
              onClick={() => setFolderOpen(true)}
              aria-label="New folder"
            >
              <FolderPlus className="h-3.5 w-3.5" /> New folder
            </Button>
            <Button size="sm" disabled={collectionID === ''} onClick={openNewPage} aria-label="New page" data-testid="wiki-new-page">
              <Plus className="h-3.5 w-3.5" /> New page
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search wiki pages"
              data-testid="kb-palette-trigger"
            >
              Search ⌘K
            </Button>
          </div>
        </div>

        {collectionID === '' ? (
          <EmptyState icon={BookOpen} title="Pick a collection" description="Select a collection above to browse its wiki." />
        ) : pagesQuery.isLoading ? (
          <Skeleton />
        ) : detailOpen ? (
          // Master-detail split: the browser collapses to a rail; the page/editor takes the rest.
          <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
            <WikiBrowser
              pages={pages}
              prefix={prefix}
              onNavigate={setPrefix}
              onOpenPage={openExisting}
              activePageID={openPageID}
              compact
            />
            {creating ? (
              <NewPageEditor
                collectionID={collectionID}
                prefix={prefix}
                onCreated={(id) => {
                  setCreating(false);
                  invalidatePages();
                  setOpenPageID(id);
                }}
                onCancel={() => setCreating(false)}
              />
            ) : (
              <InlineReader pageID={openPageID as string} onBack={() => setOpenPageID(null)} />
            )}
          </div>
        ) : (
          // Full-width browser.
          <WikiBrowser pages={pages} prefix={prefix} onNavigate={setPrefix} onOpenPage={openExisting} />
        )}
      </div>
    </PageShell>
  );
}

/** NewPageEditor — the create surface shown in the detail pane. The page's path is
 * `{prefix}{title}`, so a page created inside a folder lands in that folder. */
function NewPageEditor({
  collectionID,
  prefix,
  onCreated,
  onCancel,
}: {
  readonly collectionID: string;
  readonly prefix: string;
  readonly onCreated: (id: string) => void;
  readonly onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState('concept');
  const [tags, setTags] = useState('');
  const [description, setDescription] = useState('');

  const create = useMutation({
    mutationFn: () =>
      cloudFetch<{ id: string }>('/v1/dashboard/rag/wiki/pages', {
        method: 'POST',
        body: JSON.stringify({
          collection_id: collectionID,
          name: `${prefix}${title.trim()}`,
          content: withOkfFrontmatter(content, type, tags, description),
        }),
      }),
    onSuccess: (res) => {
      if (res?.id) onCreated(res.id);
    },
  });

  const pick = (id: string) => {
    const fill = applyTemplate(id);
    if (fill === null) return;
    setType(fill.type);
    setTags(fill.tags);
    setDescription(fill.description);
    setContent(fill.body);
  };
  const canCreate = title.trim() !== '' && content.trim() !== '' && !create.isPending;

  return (
    <Card>
      <Card.Body>
        <div className="mb-3 flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            New page
            {prefix ? (
              <>
                {' '}in <span className="font-mono text-muted-foreground">{prefix.replace(/\/$/, '')}</span>
              </>
            ) : null}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={create.isPending}>
              Cancel
            </Button>
            <Button size="sm" disabled={!canCreate} onClick={() => create.mutate()}>
              {create.isPending ? 'Creating…' : 'Create page'}
            </Button>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_15rem]">
          <div className="space-y-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Page title (e.g. auth.md)"
              aria-label="Page title"
              data-testid="new-page-title"
            />
            <KbEditor value={content} onChange={setContent} />
            {create.isError ? (
              <Alert intent="destructive" title="Could not create the page">
                Check the title and content, then try again.
              </Alert>
            ) : null}
          </div>
          <aside className="space-y-3 rounded-md border border-border bg-muted/20 p-3" aria-label="Page details">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Start from a template</div>
            <div className="flex flex-wrap gap-1.5" data-testid="kb-templates">
              {WIKI_TEMPLATES.map((t) => (
                <Button key={t.id} variant="secondary" size="sm" onClick={() => pick(t.id)} aria-label={`Use ${t.label} template`}>
                  {t.label}
                </Button>
              ))}
            </div>
            <div className="pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Page details</div>
            <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="Type (e.g. concept)" aria-label="Page type" />
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags (comma-separated)" aria-label="Page tags" />
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              aria-label="Page description"
            />
          </aside>
        </div>
      </Card.Body>
    </Card>
  );
}

// The page reader + editor shown in the detail pane. Read/Edit toggle (KB14), OKF
// header, and an autosave-style status indicator; saves via the KB0 update endpoint.
function InlineReader({ pageID, onBack }: { pageID: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/wiki/pages', 'one', pageID] as const,
    queryFn: () =>
      cloudFetch<{ id: string; name: string; content: string; status: string; okf?: OkfMeta }>(
        `/v1/dashboard/rag/wiki/pages/${encodeURIComponent(pageID)}`,
      ),
    enabled: pageID !== '',
  });
  const page = query.data;

  const save = useMutation({
    mutationFn: () => {
      const okf = page?.okf;
      const content = withOkfFrontmatter(
        draft,
        okf?.type ?? 'concept',
        (okf?.tags ?? []).join(', '),
        okf?.description ?? '',
      );
      return cloudFetch(`/v1/dashboard/rag/wiki/pages/${encodeURIComponent(pageID)}`, {
        method: 'PUT',
        body: JSON.stringify({ name: page?.name, content }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/rag/wiki/pages', 'one', pageID] });
      setEditing(false);
    },
  });

  const dirty = editing && draft.trim() !== (page?.content ?? '').trim();

  return (
    <Card>
      <Card.Body>
        <div className="mb-3 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} aria-label="Close page">
            ← Close
          </Button>
          <span className="truncate font-medium">{page?.name ?? 'Wiki page'}</span>
          <div className="ml-auto flex items-center gap-2">
            {page ? (
              <div
                className="inline-flex rounded-md border border-border p-0.5 text-sm"
                role="group"
                aria-label="View mode"
                data-testid="kb-view-toggle"
              >
                <button
                  type="button"
                  aria-pressed={!editing}
                  disabled={save.isPending}
                  onClick={() => setEditing(false)}
                  className={`rounded px-2 py-0.5 ${!editing ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Read
                </button>
                <button
                  type="button"
                  aria-pressed={editing}
                  disabled={save.isPending}
                  onClick={() => {
                    if (!editing) setDraft(page.content ?? '');
                    setEditing(true);
                  }}
                  className={`rounded px-2 py-0.5 ${editing ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Edit
                </button>
              </div>
            ) : null}
            {editing ? (
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} aria-label="Save page">
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
            ) : null}
          </div>
        </div>
        {query.isLoading ? (
          <Skeleton />
        ) : query.isError || page === null ? (
          <Alert intent="warning" title="Could not load the page">
            Try again shortly.
          </Alert>
        ) : editing ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="kb-save-status" role="status">
              <span
                className={`inline-block h-2 w-2 rounded-full ${save.isPending ? 'bg-amber-500' : dirty ? 'bg-muted-foreground' : 'bg-emerald-500'}`}
                aria-hidden="true"
              />
              {save.isPending ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}
            </div>
            <KbEditor value={draft} onChange={setDraft} />
            {save.isError ? (
              <Alert intent="destructive" title="Could not save the page">
                Try again shortly.
              </Alert>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            {page?.okf ? (
              <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium uppercase text-muted-foreground">OKF</span>
                  {page.okf.type ? <Badge variant="outline">{page.okf.type}</Badge> : null}
                  {(page.okf.tags ?? []).map((t) => (
                    <Badge key={t} variant="default">
                      {t}
                    </Badge>
                  ))}
                </div>
                {page.okf.description ? <p className="text-sm text-muted-foreground">{page.okf.description}</p> : null}
              </div>
            ) : null}
            <MarkdownView source={page?.content ?? ''} />
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
