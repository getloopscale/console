import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MessageSquare, Network } from 'lucide-react';
import ForceGraph2D from 'react-force-graph-2d';
import { Badge, Button, Card, PageShell, Select, Skeleton, Textarea } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';
import { collapseGraph, isSuperNodeId } from './graphrag/collapse-graph';

/**
 * GraphRAG — /rag/graphrag. The first-class GraphRAG explorer (Microsoft-GraphRAG-style). The graph
 * is built ONCE at ingestion and persisted, so it is shown ALWAYS (no question needed): pick a
 * collection → the knowledge graph renders (entities as nodes coloured by community, sized by degree)
 * next to the community reports (the "always-generated sensemaking"). A Leiden level slider re-reads
 * the hierarchy. Ask is a SECONDARY panel (global sensemaking / entity graph) layered on top.
 *
 * Reads the M10 BFF endpoints (which proxy theo-rag): `/collections/{id}/graph` + `/communities`.
 * The graph JSON is forwarded opaquely by the BFF; this page renders it. No fabrication.
 */

interface Collection {
  id: string;
  name: string | null;
}
interface GraphNode {
  id: string;
  name: string;
  type: string;
  degree: number;
  community_key: string | null;
}
interface GraphLink {
  source: string;
  target: string;
  weight: number;
}
interface GraphData {
  nodes: GraphNode[];
  edges: GraphLink[];
}
interface Community {
  community_key: string;
  level: number;
  size: number;
  summary: string | null;
  member_names: string[];
}
interface CommunitiesData {
  communities: Community[];
}
interface Source {
  document_id?: string;
  chunk_id?: string;
  score?: number;
}
interface AnswerResult {
  answer: string;
  sources?: Source[];
  strategy?: string;
  router?: { strategy?: string; fell_back?: boolean };
}

const LEVELS = ['0', '1', '2', '3'] as const;
const GRAPH_MODES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'global', label: 'Global sensemaking' },
  { value: 'graph', label: 'Entity graph' },
];
const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
const fmt = (n: number): string => NUMBER_FORMAT.format(n);

export function RagGraphRagPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('RAG · GraphRAG'), [setPageTitle]);
  useRequireAuth();

  const [collectionID, setCollectionID] = useState('');
  const [level, setLevel] = useState('0');
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState('global');

  // Measure the graph container so the canvas fills the card (react-force-graph needs explicit px).
  // M13 — measure BOTH dimensions + track resize so the full-height explorer canvas stays responsive.
  const graphBox = useRef<HTMLDivElement | null>(null);
  const [graphSize, setGraphSize] = useState({ w: 640, h: 560 });
  useEffect(() => {
    const el = graphBox.current;
    if (!el) return;
    const measure = () => setGraphSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [collectionID]);

  // M13 — clicking a community (or a node) focuses it: its nodes keep colour, the rest dim.
  const [focusCommunity, setFocusCommunity] = useState<string | null>(null);
  // M13 — collapsed communities render as a single aggregate super-node (expand to see members).
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggleCollapsed = (key: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const collectionsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/collections'] as const,
    queryFn: () => cloudFetch<{ items: Collection[] }>('/v1/dashboard/rag/collections'),
  });
  const graphQuery = useQuery({
    enabled: collectionID !== '',
    queryKey: ['cloud', 'rag-graph', collectionID, level] as const,
    queryFn: () =>
      cloudFetch<GraphData>(
        `/v1/dashboard/rag/collections/${encodeURIComponent(collectionID)}/graph?level=${level}&limit=300`,
      ),
  });
  const communitiesQuery = useQuery({
    enabled: collectionID !== '',
    queryKey: ['cloud', 'rag-communities', collectionID, level] as const,
    queryFn: () =>
      cloudFetch<CommunitiesData>(
        `/v1/dashboard/rag/collections/${encodeURIComponent(collectionID)}/communities?level=${level}`,
      ),
  });

  const ask = useMutation({
    mutationFn: () =>
      cloudFetch<AnswerResult>('/v1/dashboard/rag/answers', {
        method: 'POST',
        body: JSON.stringify({ collection_id: collectionID, question, strategy: mode }),
      }),
  });

  const collections = collectionsQuery.data?.items ?? [];
  const graph = graphQuery.data;
  const communities = communitiesQuery.data?.communities ?? [];
  const answer = ask.data;

  // react-force-graph expects { nodes, links }; links reference node ids via source/target.
  // M13 — collapsed communities are folded into aggregate super-nodes before rendering.
  const graphData = graph
    ? collapseGraph(
        graph.nodes,
        graph.edges.map((e) => ({ source: e.source, target: e.target, weight: e.weight })),
        collapsed,
      )
    : { nodes: [], links: [] };

  // M13 — deterministic HSL per community_key (stable colour across renders) with a dim state
  // for nodes outside the focused community, so a click actually highlights a community's subgraph.
  const nodeColor = (n: object): string => {
    const key = (n as GraphNode).community_key ?? '';
    if (focusCommunity !== null && key !== focusCommunity) return 'rgba(100,116,139,0.25)';
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
    return `hsl(${h}, 65%, 60%)`;
  };

  return (
    <PageShell
      title="GraphRAG"
      description="The knowledge graph your corpus built — always on. Explore entities + communities, then ask across the whole corpus."
    >
      <div className="space-y-6">
        <Card>
          <Card.Body>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-56 flex-1 space-y-1">
                <label className="text-sm font-medium text-muted-foreground">Collection</label>
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
              </div>
              <div className="w-40 space-y-1">
                <label className="text-sm font-medium text-muted-foreground">Community level</label>
                <Select value={level} onValueChange={setLevel}>
                  <Select.Trigger className="w-full" aria-label="Community level">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {LEVELS.map((l) => (
                      <Select.Item key={l} value={l}>
                        Level {l}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
            </div>
          </Card.Body>
        </Card>

        {collectionID === '' ? (
          <Alert intent="info" title="Pick a collection">
            Select a collection to explore its knowledge graph and community reports.
          </Alert>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Knowledge graph — always rendered on collection pick, no question needed. */}
            <Card className="lg:col-span-2">
              <Card.Header>
                <div className="flex items-center gap-2">
                  <Network className="size-4 text-muted-foreground" aria-hidden="true" />
                  <Card.Title>Knowledge graph</Card.Title>
                </div>
                <Card.Description>Entities as nodes (sized by connections, coloured by community).</Card.Description>
              </Card.Header>
              <Card.Body>
                {graphQuery.isLoading ? (
                  <Skeleton />
                ) : graphQuery.isError ? (
                  <Alert intent="warning" title="Could not load the graph">
                    The graph service is unavailable. Try again shortly.
                  </Alert>
                ) : graph && graph.nodes.length > 0 ? (
                  <>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm text-muted-foreground" data-testid="graph-summary">
                        {fmt(graph.nodes.length)} entities · {fmt(graph.edges.length)} relationships
                        {focusCommunity !== null ? <> · focused on <span className="font-mono">{focusCommunity}</span></> : null}
                      </p>
                      {focusCommunity !== null ? (
                        <Button variant="ghost" size="sm" onClick={() => setFocusCommunity(null)}>
                          Clear focus
                        </Button>
                      ) : null}
                    </div>
                    <div ref={graphBox} className="h-[70vh] min-h-[420px] w-full overflow-hidden rounded border border-border bg-muted/20">
                      <ForceGraph2D
                        graphData={graphData}
                        width={graphSize.w}
                        height={graphSize.h}
                        nodeColor={nodeColor}
                        nodeVal={(n: object) => 1 + Math.sqrt((n as GraphNode).degree)}
                        nodeLabel={(n: object) => (n as GraphNode).name}
                        onNodeClick={(n: object) => {
                          const node = n as GraphNode;
                          if (isSuperNodeId(node.id)) {
                            toggleCollapsed(node.community_key ?? ''); // click a super-node → expand it
                            return;
                          }
                          setFocusCommunity((cur) => (cur === node.community_key ? null : node.community_key));
                        }}
                        linkColor={() => 'rgba(148,163,184,0.35)'}
                        cooldownTicks={80}
                      />
                    </div>
                  </>
                ) : (
                  <Alert intent="info" title="No graph yet">
                    This collection has no extracted graph. Ingest documents and run graph extraction to build it.
                  </Alert>
                )}
              </Card.Body>
            </Card>

            {/* Community reports — the always-generated sensemaking summaries. */}
            <Card>
              <Card.Header>
                <Card.Title>Community reports</Card.Title>
                <Card.Description>Auto-generated summaries of the graph’s communities at this level.</Card.Description>
              </Card.Header>
              <Card.Body className="space-y-3">
                {communitiesQuery.isLoading ? (
                  <Skeleton />
                ) : communities.length > 0 ? (
                  <ul className="space-y-3">
                    {communities.map((c) => (
                      <li
                        key={c.community_key}
                        className={`cursor-pointer rounded border p-3 transition-colors ${
                          focusCommunity === c.community_key ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                        }`}
                        role="button"
                        tabIndex={0}
                        aria-pressed={focusCommunity === c.community_key}
                        aria-label={`Focus community ${c.community_key}`}
                        onClick={() => setFocusCommunity((cur) => (cur === c.community_key ? null : c.community_key))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setFocusCommunity((cur) => (cur === c.community_key ? null : c.community_key));
                          }
                        }}
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{c.community_key}</span>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline">{fmt(c.size)} members</Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-pressed={collapsed.has(c.community_key)}
                              aria-label={`${collapsed.has(c.community_key) ? 'Expand' : 'Collapse'} community ${c.community_key}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleCollapsed(c.community_key);
                              }}
                            >
                              {collapsed.has(c.community_key) ? 'Expand' : 'Collapse'}
                            </Button>
                          </div>
                        </div>
                        <p className="text-sm">{c.summary ?? 'Summary not generated yet.'}</p>
                        {c.member_names.length > 0 ? (
                          <p className="mt-1 text-xs text-muted-foreground">{c.member_names.slice(0, 8).join(' · ')}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No communities at this level.</p>
                )}
              </Card.Body>
            </Card>
          </div>
        )}

        {/* Ask — secondary: query the graph with global sensemaking / entity-graph retrieval. */}
        {collectionID !== '' ? (
          <Card>
            <Card.Header>
              <div className="flex items-center gap-2">
                <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
                <Card.Title>Ask the graph</Card.Title>
              </div>
            </Card.Header>
            <Card.Body>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (question.trim()) ask.mutate();
                }}
              >
                <Textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask a broad question about the whole corpus…"
                  aria-label="Question"
                  rows={2}
                />
                <div className="flex items-center justify-between gap-3">
                  <Select value={mode} onValueChange={setMode}>
                    <Select.Trigger className="w-56" aria-label="GraphRAG mode">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      {GRAPH_MODES.map((m) => (
                        <Select.Item key={m.value} value={m.value}>
                          {m.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                  <Button type="submit" disabled={question.trim() === '' || ask.isPending}>
                    Ask
                  </Button>
                </div>
              </form>
              {ask.isError ? (
                <Alert intent="warning" title="Could not answer" className="mt-3">
                  The RAG service is unavailable. Try again shortly.
                </Alert>
              ) : answer ? (
                <div className="mt-4 space-y-2">
                  {answer.router?.strategy ?? answer.strategy ? (
                    <Badge variant="outline">
                      {answer.router?.strategy ?? answer.strategy}
                      {answer.router?.fell_back ? ' · fell back to vector' : ''}
                    </Badge>
                  ) : null}
                  <p className="whitespace-pre-wrap">{answer.answer}</p>
                </div>
              ) : null}
            </Card.Body>
          </Card>
        ) : null}
      </div>
    </PageShell>
  );
}
