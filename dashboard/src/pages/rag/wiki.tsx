import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, PageShell, Select, Sheet, Skeleton, Textarea } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

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

  // M26 — the deterministic OKF index (progressive disclosure, generated from frontmatter).
  const indexQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/wiki/index', collectionID] as const,
    queryFn: () =>
      cloudFetch<{ markdown: string }>(`/v1/dashboard/rag/wiki/index?collection_id=${encodeURIComponent(collectionID)}`),
    enabled: collectionID !== '',
  });

  const collections = collectionsQuery.data?.items ?? [];
  const pages = pagesQuery.data?.items ?? [];
  const okfIndex = indexQuery.data?.markdown ?? '';
  const canCreate = collectionID !== '' && name.trim() !== '' && content.trim() !== '' && !create.isPending;

  return (
    <PageShell title="Wiki" description="Markdown-native wiki pages your team can read and Ask over.">
      <div className="space-y-6">
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

              <div className="space-y-2">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Page title"
                  aria-label="Page title"
                  disabled={collectionID === ''}
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Input
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    placeholder="Type (e.g. concept, metric)"
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
                </div>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Write the page in markdown…"
                  aria-label="Page content"
                  rows={6}
                  disabled={collectionID === ''}
                />
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
            </div>
          </Card.Body>
        </Card>

        {collectionID !== '' && okfIndex.trim() !== '' ? (
          <Card>
            <Card.Body>
              <div className="mb-2 flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">OKF index</span>
                <span className="ml-auto text-xs text-muted-foreground">progressive disclosure · generated from frontmatter</span>
              </div>
              <pre className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{okfIndex}</pre>
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
      </div>

      <WikiPageSheet pageID={openPageID} onClose={() => setOpenPageID(null)} />
    </PageShell>
  );
}

function WikiPageSheet({ pageID, onClose }: { pageID: string | null; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/wiki/pages', 'one', pageID] as const,
    queryFn: () => cloudFetch<{ id: string; name: string; content: string; status: string; okf?: OkfMeta }>(
      `/v1/dashboard/rag/wiki/pages/${encodeURIComponent(pageID ?? '')}`,
    ),
    enabled: pageID !== null,
  });
  const page = query.data;
  return (
    <Sheet open={pageID !== null} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <Sheet.Content side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-2xl">
        <Sheet.Header>
          <Sheet.Title className="pr-6">{page?.name ?? 'Wiki page'}</Sheet.Title>
          <Sheet.Description>Ask over this page for citation-backed answers.</Sheet.Description>
        </Sheet.Header>
        <div className="py-4">
          {query.isLoading ? (
            <Skeleton />
          ) : query.isError || page === null ? (
            <Alert intent="warning" title="Could not load the page">
              Try again shortly.
            </Alert>
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
              <pre className="whitespace-pre-wrap break-words text-sm text-foreground">{page?.content}</pre>
            </div>
          )}
        </div>
      </Sheet.Content>
    </Sheet>
  );
}
