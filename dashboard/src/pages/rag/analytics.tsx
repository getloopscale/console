import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCollections } from '@/hooks/rag/use-collections';
import { Card, MetricCard, PageShell, Select, Skeleton } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/http/api';

/**
 * M21 + v8-M7 — /rag/analytics. Read-only usage/cost/latency for the caller's workspace,
 * via the dashboard BFF `GET /v1/dashboard/rag/analytics` (the theo-rag M5 summary).
 *
 * v8-M7 (scale observability): when the operator picks a collection, the page fetches
 * `?collection_id=X` and renders the per-collection `scale` block returned by theo-rag
 * rc.80+ (extraction tokens, community count/level, corpus size). Without a collection
 * selected the M5 summary is shown alone (backward-compat).
 */


interface AnalyticsResult {
  window: { since: string };
  totals: { retrievals: number; answers: number; empty_retrieval_rate: number };
  latency: { p50_ms: number; p95_ms: number };
  confidence: { high: number; medium: number; low: number };
  scale?: ScaleObservability;
}

interface ScaleObservability {
  collection_id: string;
  corpus: { documents: number; chunks: number; size_bytes: number };
  communities: { total: number; max_level: number; per_level: Record<string, number> };
  extraction: { tokens: number };
}

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
function fmt(n: number): string {
  return NUMBER_FORMAT.format(n);
}
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function RagAnalyticsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('RAG · Analytics'), [setPageTitle]);
  useRequireAuth();

  const [collectionID, setCollectionID] = useState('');

  const collectionsQuery = useCollections();

  // When a collection is picked, the fetch key changes AND the URL carries
  // `?collection_id=` — theo-rag rc.80+ attaches the `scale` block only then.
  const analyticsPath = collectionID
    ? `/v1/dashboard/rag/analytics?collection_id=${encodeURIComponent(collectionID)}`
    : '/v1/dashboard/rag/analytics';
  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/analytics', collectionID] as const,
    // silent-null-ok: o consumo deste hook ja trata `null` resolvido como erro (`isError || (isFetched && data === null)`), entao a falha nao vira estado vazio. #274
    queryFn: () => cloudFetch<AnalyticsResult>(analyticsPath),
  });

  const collections = collectionsQuery.data?.items ?? [];

  return (
    <PageShell title="Analytics" description="Retrieval + answer usage for this workspace.">
      <div className="space-y-6">
        <Card>
          <Card.Body>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Collection (scale details)</label>
              <Select value={collectionID} onValueChange={setCollectionID}>
                <Select.Trigger className="w-full" aria-label="Collection">
                  <Select.Value placeholder="Select a collection to see per-collection scale…" />
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
          </Card.Body>
        </Card>

        {query.isLoading ? (
          <Skeleton />
        ) : query.isError || query.data == null ? (
          <Alert intent="warning" title="Could not load analytics">
            The RAG analytics service is unavailable. Try again shortly.
          </Alert>
        ) : (
          <>
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
              <MetricCard title="Retrievals" value={fmt(query.data.totals.retrievals)} />
              <MetricCard title="Answers" value={fmt(query.data.totals.answers)} />
              <MetricCard
                title="Empty-retrieval rate"
                value={`${Math.round(query.data.totals.empty_retrieval_rate * 100)}%`}
              />
              <MetricCard title="Latency p50" value={`${Math.round(query.data.latency.p50_ms)} ms`} />
              <MetricCard title="Latency p95" value={`${Math.round(query.data.latency.p95_ms)} ms`} />
              <MetricCard
                title="Answer confidence (H/M/L)"
                value={`${query.data.confidence.high}/${query.data.confidence.medium}/${query.data.confidence.low}`}
              />
            </div>

            {query.data.scale ? (
              <ScaleSection scale={query.data.scale} />
            ) : collectionID ? (
              <Alert intent="info" title="No scale data yet">
                This collection has not been ingested or graph-extracted. Add a document to see scale numbers.
              </Alert>
            ) : null}
          </>
        )}
      </div>
    </PageShell>
  );
}

function ScaleSection({ scale }: { scale: ScaleObservability }) {
  const perLevelKeys = Object.keys(scale.communities.per_level).sort(
    (a, b) => Number(a) - Number(b),
  );
  return (
    <Card>
      <Card.Header>
        <Card.Title>Collection scale</Card.Title>
        <Card.Description>
          LLM extraction cost, graph communities, and corpus size for the selected collection.
        </Card.Description>
      </Card.Header>
      <Card.Body>
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard title="Extraction tokens" value={fmt(scale.extraction.tokens)} />
          <MetricCard title="Documents" value={fmt(scale.corpus.documents)} />
          <MetricCard title="Chunks" value={fmt(scale.corpus.chunks)} />
          <MetricCard title="Corpus size" value={fmtBytes(scale.corpus.size_bytes)} />
          <MetricCard
            title="Communities (max level)"
            value={`${fmt(scale.communities.total)} (${scale.communities.max_level})`}
          />
        </div>
        {perLevelKeys.length > 0 ? (
          <div className="mt-4">
            <div className="mb-2 text-sm font-medium text-muted-foreground">Communities per level</div>
            <ul className="grid gap-1 grid-cols-2 sm:grid-cols-4 text-sm">
              {perLevelKeys.map((k) => (
                <li key={k} className="flex justify-between rounded border border-border bg-muted/40 px-2 py-1">
                  <span>Level {k}</span>
                  <span className="font-semibold">{fmt(scale.communities.per_level[k]!)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card.Body>
    </Card>
  );
}
