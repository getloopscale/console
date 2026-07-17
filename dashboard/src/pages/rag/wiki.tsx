import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { Badge, Button, Card, CommandPalette, EmptyState, Input, PageShell, Select, Skeleton } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import { MarkdownView } from '@/components/common/markdown-view';
import { WikiTree } from './wiki-tree';
import { KbEditor } from '@/components/rag/kb-editor';
import { applyTemplate, WIKI_TEMPLATES } from './wiki-templates';
import { toCommandItems } from './wiki-command';

import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * Open Wiki — /rag/wiki. Markdown-native, per-tenant wiki pages backed by theo-rag
 * (a wiki page is a source_type='wiki' document). Pick a collection → see its wiki
 * pages, create a new markdown page, and open one to read it. New/edited pages are
 * automatically searchable in Ask (citation-backed). The agent-maintained evolve loop
 * is the next slice; this is the human-facing surface.
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
interface WikiPage {
  id: string;
  name: string;
  status: string;
  updated_at?: string;
  type?: string;
  tags?: string[];
}

/**
 * Build an OKF (Open Knowledge Format) frontmatter fence from the structured fields and
 * prepend it to the body. The data-plane parser (theo-rag) splits this back into
 * `documents.metadata.okf` + the stripped body. Only emits a fence when a non-default
 * field is set, so a plain page stays plain.
 */
function withOkfFrontmatter(body: string, type: string, tags: string, description: string): string {
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
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState('concept');
  const [tags, setTags] = useState('');
  const [description, setDescription] = useState('');
  const [openPageID, setOpenPageID] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // KB14 — Cmd/Ctrl+K opens the wiki page palette (jump to any page without navigation).
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

  const create = useMutation({
    mutationFn: () =>
      cloudFetch<{ id: string }>('/v1/dashboard/rag/wiki/pages', {
        method: 'POST',
        body: JSON.stringify({
          collection_id: collectionID,
          name,
          // OKF frontmatter (type/tags/description) is folded into the content fence;
          // the data-plane parser splits it back into structured okf metadata (M24).
          content: withOkfFrontmatter(content, type, tags, description),
        }),
      }),
    onSuccess: () => {
      setName('');
      setContent('');
      setType('concept');
      setTags('');
      setDescription('');
      void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/rag/wiki/pages', collectionID] });
    },
  });

  const collections = collectionsQuery.data?.items ?? [];
  const pages = pagesQuery.data?.items ?? [];
  // KB13 — a template pre-fills the body AND the OKF frontmatter fields on the create form.
  const pickTemplate = (id: string) => {
    const fill = applyTemplate(id);
    if (fill === null) return;
    setType(fill.type);
    setTags(fill.tags);
    setDescription(fill.description);
    setContent(fill.body);
  };

  const canCreate = collectionID !== '' && name.trim() !== '' && content.trim() !== '' && !create.isPending;

  return (
    <PageShell title="Wiki" description="Markdown-native wiki pages your team can read and Ask over.">
      {/* KB14 — Cmd+K page palette (jump to any page). */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={toCommandItems(pages)}
        onSelect={(id) => {
          setOpenPageID(id);
          setPaletteOpen(false);
        }}
        placeholder="Search wiki pages…"
        emptyMessage={pages.length === 0 ? 'Select a collection to search its pages.' : 'No matching pages.'}
      />
      <div className="space-y-6">
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search wiki pages"
            data-testid="kb-palette-trigger"
          >
            Search pages ⌘K
          </Button>
        </div>
        {openPageID !== null ? (
          <InlineReader pageID={openPageID} onBack={() => setOpenPageID(null)} />
        ) : (
          <>
        <Card>
          <Card.Body>
            <div className="space-y-4">
              <Select value={collectionID} onValueChange={setCollectionID}>
                <Select.Trigger className="w-full" aria-label="Collection">
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

              {/* KB13 — main editor column + a metadata rail (templates + OKF details). */}
              <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
                <div className="space-y-2">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Page title"
                    aria-label="Page title"
                    disabled={collectionID === ''}
                  />
                  <KbEditor value={content} onChange={setContent} editable={collectionID !== ''} />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {collectionID === '' ? 'Select a collection first.' : 'New pages become searchable in Ask automatically.'}
                    </span>
                    <Button size="sm" disabled={!canCreate} onClick={() => create.mutate()}>
                      {create.isPending ? 'Creating…' : 'Create page'}
                    </Button>
                  </div>
                  {create.isError ? (
                    <Alert intent="destructive" title="Could not create the page">
                      Check the title and content, then try again.
                    </Alert>
                  ) : null}
                </div>

                <aside
                  className="space-y-3 rounded-md border border-border bg-muted/20 p-3"
                  aria-label="Page details"
                >
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Start from a template
                  </div>
                  <div className="flex flex-wrap gap-1.5" data-testid="kb-templates">
                    {WIKI_TEMPLATES.map((t) => (
                      <Button
                        key={t.id}
                        variant="secondary"
                        size="sm"
                        disabled={collectionID === ''}
                        onClick={() => pickTemplate(t.id)}
                        aria-label={`Use ${t.label} template`}
                      >
                        {t.label}
                      </Button>
                    ))}
                  </div>
                  <div className="pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Page details
                  </div>
                  <Input
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    placeholder="Type (e.g. concept)"
                    aria-label="Page type"
                    disabled={collectionID === ''}
                  />
                  <Input
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="Tags (comma-separated)"
                    aria-label="Page tags"
                    disabled={collectionID === ''}
                  />
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Description"
                    aria-label="Page description"
                    disabled={collectionID === ''}
                  />
                </aside>
              </div>
            </div>
          </Card.Body>
        </Card>

        {collectionID !== '' && pages.length > 0 ? (
          <Card>
            <Card.Body>
              <div className="mb-2 flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Pages</span>
                <span className="ml-auto text-xs text-muted-foreground">organized by folder</span>
              </div>
              <WikiTree pages={pages} onOpen={setOpenPageID} />
            </Card.Body>
          </Card>
        ) : null}

        {collectionID === '' ? (
          <EmptyState icon={BookOpen} title="Pick a collection" description="Select a collection above to see its wiki pages." />
        ) : pagesQuery.isLoading ? (
          <Skeleton />
        ) : pages.length === 0 ? (
          <EmptyState icon={BookOpen} title="No wiki pages yet" description="Create your first markdown page above." />
        ) : (
          <div className="space-y-2">
            {pages.map((p) => (
              <Card key={p.id}>
                <Card.Body>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{p.name}</span>
                      {p.type && p.type !== 'concept' ? <Badge variant="outline">{p.type}</Badge> : null}
                      <Badge variant={p.status === 'ready' ? 'default' : 'outline'}>{p.status}</Badge>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setOpenPageID(p.id)} aria-label={`Open ${p.name}`}>
                      Open
                    </Button>
                  </div>
                </Card.Body>
              </Card>
            ))}
          </div>
        )}
          </>
        )}
      </div>
    </PageShell>
  );
}

// KB2/KB3 — inline full-column page reader + editor (replaces the right-side Sheet slide-over).
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

  // KB3 — save an edit through the KB0 update endpoint (OKF-aware; re-embeds server-side).
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
      void queryClient.invalidateQueries({
        queryKey: ['cloud', '/v1/dashboard/rag/wiki/pages', 'one', pageID],
      });
      setEditing(false);
    },
  });

  // KB13 — autosave-style indicator: dirty (unsaved) → saving → saved.
  const dirty = editing && draft.trim() !== (page?.content ?? '').trim();

  return (
    <Card>
      <Card.Body>
        <div className="mb-3 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back to pages">
            ← Back
          </Button>
          <span className="truncate font-medium">{page?.name ?? 'Wiki page'}</span>
          <div className="ml-auto flex items-center gap-2">
            {/* KB14 — one-click Read/Edit toggle (no navigation between modes). */}
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
            <div
              className="flex items-center gap-2 text-xs text-muted-foreground"
              data-testid="kb-save-status"
              role="status"
            >
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
                {page.okf.description ? (
                  <p className="text-sm text-muted-foreground">{page.okf.description}</p>
                ) : null}
              </div>
            ) : null}
            <MarkdownView source={page?.content ?? ''} />
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
