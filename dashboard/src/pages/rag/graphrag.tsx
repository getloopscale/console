import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MessageSquare, Network } from 'lucide-react';
import { Badge, Button, Card, MetricCard, PageShell, Select, Skeleton, Textarea } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * GraphRAG — /rag/graphrag. A first-class destination for the GraphRAG capability (Microsoft-
 * GraphRAG-style): ask across the WHOLE corpus via community-summary global sensemaking or
 * entity-graph traversal, and see the graph the extraction built (communities per level).
 *
 * Composes existing surfaces — no new endpoint: the Ask half POSTs the dashboard BFF
 * `/v1/dashboard/rag/answers` with strategy=global|graph; the communities panel reads the
 * per-collection `scale.communities` block from `GET /v1/dashboard/rag/analytics?collection_id=`.
 * The richer explorer (community REPORT text + entity/relationship graph viz) needs new theo-rag
 * endpoints and is marked as the next step in the panel — never fabricated here.
 */

interface Collection {
  id: string;
  name: string | null;
}
interface Source {
  document_id?: string;
  chunk_id?: string;
  score?: number;
}
interface AnswerResult {
  answer: string;
  sources?: Source[];
  confidence?: string;
  strategy?: string;
  router?: { strategy?: string; fell_back?: boolean; reason?: string };
}
interface ScaleObservability {
  communities: { total: number; max_level: number; per_level: Record<string, number> };
}
interface AnalyticsResult {
  scale?: ScaleObservability;
}

// The two GraphRAG retrieval modes (a focused subset of the Ask strategy enum). Both fail-close to
// vector upstream when the collection has no extracted graph — surfaced honestly on the answer badge.
const GRAPH_MODES: ReadonlyArray<{ value: string; label: string; hint: string }> = [
  { value: 'global', label: 'Global sensemaking', hint: 'Answer over the whole corpus from community summaries' },
  { value: 'graph', label: 'Entity graph', hint: 'Traverse the entity/relationship graph' },
];

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
const fmt = (n: number): string => NUMBER_FORMAT.format(n);

export function RagGraphRagPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('RAG · GraphRAG'), [setPageTitle]);
  useRequireAuth();

  const [collectionID, setCollectionID] = useState('');
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState('global');

  const collectionsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/collections'] as const,
    queryFn: () => cloudFetch<{ items: Collection[] }>('/v1/dashboard/rag/collections'),
  });

  // Communities panel — reuses the per-collection scale block (loads only once a collection is picked).
  const analyticsQuery = useQuery({
    enabled: collectionID !== '',
    queryKey: ['cloud', '/v1/dashboard/rag/analytics', 'graphrag', collectionID] as const,
    queryFn: () =>
      cloudFetch<AnalyticsResult>(`/v1/dashboard/rag/analytics?collection_id=${encodeURIComponent(collectionID)}`),
  });

  const ask = useMutation({
    mutationFn: () =>
      cloudFetch<AnswerResult>('/v1/dashboard/rag/answers', {
        method: 'POST',
        // Always send a GraphRAG strategy here (this is the GraphRAG destination — never the default vector).
        body: JSON.stringify({ collection_id: collectionID, question, strategy: mode }),
      }),
  });

  const collections = collectionsQuery.data?.items ?? [];
  const answer = ask.data;
  const communities = analyticsQuery.data?.scale?.communities;

  return (
    <PageShell
      title="GraphRAG"
      description="Ask across your whole corpus — community-summary sensemaking or entity-graph retrieval."
    >
      <div className="space-y-6">
        <Card>
          <Card.Body>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (collectionID && question.trim()) ask.mutate();
              }}
            >
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
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a broad question about the whole corpus…"
                aria-label="Question"
                rows={3}
              />
              <div className="flex items-center justify-between gap-3">
                <Select value={mode} onValueChange={setMode}>
                  <Select.Trigger className="w-64" aria-label="GraphRAG mode">
                    <Select.Value placeholder="Mode" />
                  </Select.Trigger>
                  <Select.Content>
                    {GRAPH_MODES.map((m) => (
                      <Select.Item key={m.value} value={m.value}>
                        {m.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
                <Button type="submit" disabled={collectionID === '' || question.trim() === '' || ask.isPending}>
                  Ask
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {GRAPH_MODES.find((m) => m.value === mode)?.hint}. Falls back to fast semantic search when the
                collection has no extracted graph.
              </p>
            </form>
          </Card.Body>
        </Card>

        {ask.isError ? (
          <Alert intent="warning" title="Could not answer the question">
            The RAG service is unavailable. Try again shortly.
          </Alert>
        ) : answer ? (
          <Card>
            <Card.Header>
              <div className="flex items-center gap-2">
                <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-base font-semibold">Answer</h2>
                {answer.confidence ? <Badge variant="default">{answer.confidence}</Badge> : null}
                {answer.router?.strategy ?? answer.strategy ? (
                  <Badge variant="outline">
                    {answer.router?.strategy ?? answer.strategy}
                    {answer.router?.fell_back ? ' · fell back to vector' : ''}
                  </Badge>
                ) : null}
              </div>
            </Card.Header>
            <Card.Body className="space-y-3">
              <p className="whitespace-pre-wrap">{answer.answer}</p>
              {answer.sources && answer.sources.length > 0 ? (
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-muted-foreground">Sources</h4>
                  <ul className="space-y-1 text-sm">
                    {answer.sources.map((s, i) => (
                      <li key={i} className="font-mono">
                        {s.document_id ?? s.chunk_id ?? 'source'}
                        {s.score != null ? ` · ${s.score.toFixed(3)}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card.Body>
          </Card>
        ) : null}

        {/* Communities panel — the graph the extraction built (from the analytics scale block). */}
        <Card>
          <Card.Header>
            <div className="flex items-center gap-2">
              <Network className="size-4 text-muted-foreground" aria-hidden="true" />
              <Card.Title>Knowledge graph</Card.Title>
            </div>
            <Card.Description>Communities the graph extraction built for the selected collection.</Card.Description>
          </Card.Header>
          <Card.Body>
            {collectionID === '' ? (
              <p className="text-sm text-muted-foreground">Select a collection to see its graph communities.</p>
            ) : analyticsQuery.isLoading ? (
              <Skeleton />
            ) : analyticsQuery.isError ? (
              <Alert intent="warning" title="Could not load the graph">
                The analytics service is unavailable. Try again shortly.
              </Alert>
            ) : communities && communities.total > 0 ? (
              <>
                <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
                  <MetricCard title="Communities" value={fmt(communities.total)} />
                  <MetricCard title="Max level" value={fmt(communities.max_level)} />
                  <MetricCard title="Levels" value={fmt(Object.keys(communities.per_level).length)} />
                </div>
                {Object.keys(communities.per_level).length > 0 ? (
                  <div className="mt-4">
                    <div className="mb-2 text-sm font-medium text-muted-foreground">Communities per level</div>
                    <ul className="grid gap-1 grid-cols-2 sm:grid-cols-4 text-sm">
                      {Object.keys(communities.per_level)
                        .sort((a, b) => Number(a) - Number(b))
                        .map((k) => (
                          <li
                            key={k}
                            className="flex justify-between rounded border border-border bg-muted/40 px-2 py-1"
                          >
                            <span>Level {k}</span>
                            <span className="font-semibold">{fmt(communities.per_level[k]!)}</span>
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}
                <p className="mt-4 text-xs text-muted-foreground">
                  Community report summaries and the interactive entity/relationship graph are coming — they need
                  new theo-rag graph endpoints.
                </p>
              </>
            ) : (
              <Alert intent="info" title="No graph yet">
                This collection has no extracted graph. Ingest documents and run graph extraction to build
                communities.
              </Alert>
            )}
          </Card.Body>
        </Card>
      </div>
    </PageShell>
  );
}
