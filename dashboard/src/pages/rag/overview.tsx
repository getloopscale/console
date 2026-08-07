import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Boxes, MessageSquare, RefreshCw, ScrollText, Search, Timer } from 'lucide-react';
import { Button, Card, MetricCard, PageShell, Skeleton } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * M23 — /rag landing (Overview). The first customer-visible RAG surface, mirroring
 * the Memory Overview (`pages/memory.tsx`, Rule 9): a KPI strip from the RAG M5
 * summary (`GET /v1/dashboard/rag/analytics`) + a Getting-started card + an Explore
 * grid to the sub-pages. Every capability section opens on an Overview; RAG now does too.
 */

interface AnalyticsResult {
  window: { since: string };
  totals: { retrievals: number; answers: number; empty_retrieval_rate: number };
  latency: { p50_ms: number; p95_ms: number };
  confidence: { high: number; medium: number; low: number };
}

export function RagOverviewPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('RAG'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/analytics'] as const,
    queryFn: () => cloudFetch<AnalyticsResult>('/v1/dashboard/rag/analytics', {}, { throwOnError: true }),
  });

  const onRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/rag/analytics'] });
  };

  return (
    <PageShell
      title="RAG"
      description="Store documents and answer questions with citation-backed retrieval."
      primaryAction={{ label: 'Refresh', icon: RefreshCw, onClick: onRefresh, loading: query.isFetching }}
    >
      <div className="space-y-6">
        {query.isError ? (
          <Alert intent="warning" title="Could not load RAG metrics">
            The RAG service is not reachable right now. Try refreshing in a moment.
          </Alert>
        ) : null}

        {query.isPending ? (
          <div
            data-testid="rag-metrics-loading"
            role="status"
            aria-label="Loading RAG metrics"
            className="grid grid-cols-2 lg:grid-cols-4 gap-4"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : null}

        {query.isSuccess && query.data != null ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard title="Retrievals" value={query.data.totals.retrievals} icon={<Search className="h-4 w-4" aria-hidden="true" />} />
            <MetricCard title="Answers" value={query.data.totals.answers} icon={<MessageSquare className="h-4 w-4" aria-hidden="true" />} />
            <MetricCard
              title="Empty-retrieval %"
              value={Math.round(query.data.totals.empty_retrieval_rate * 100)}
              icon={<Activity className="h-4 w-4" aria-hidden="true" />}
            />
            <MetricCard title="Latency p95 (ms)" value={Math.round(query.data.latency.p95_ms)} icon={<Timer className="h-4 w-4" aria-hidden="true" />} />
          </div>
        ) : null}

        {/* KB7 — quick actions unify the Knowledge Base surfaces into one home. */}
        <Card>
          <Card.Body>
            <h2 className="mb-3 text-base font-semibold">Quick actions</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="kb-quick-actions">
              <Button variant="secondary" onClick={() => (window.location.href = '/rag/wiki')} aria-label="New wiki page">
                New page
              </Button>
              <Button variant="secondary" onClick={() => (window.location.href = '/rag/documents')} aria-label="Upload a document">
                Upload document
              </Button>
              <Button variant="secondary" onClick={() => (window.location.href = '/rag/ask')} aria-label="Ask a question">
                Ask a question
              </Button>
            </div>
          </Card.Body>
        </Card>

        <Card>
          <Card.Body className="space-y-2">
            <h2 className="text-base font-semibold">Getting started</h2>
            <p className="text-sm text-muted-foreground">
              Create a collection, ingest documents from the SDK or the Collections tab, then query them
              with <code>theo.rag(workspace).ask(collectionId, question)</code>.
            </p>
            <Button variant="ghost" onClick={() => (window.location.href = '/rag/collections')}>
              Browse collections →
            </Button>
          </Card.Body>
        </Card>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">Explore</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <ExploreCard
              icon={Boxes}
              title="Collections"
              description="Create and manage the collections documents are ingested into."
              href="/rag/collections"
            />
            <ExploreCard
              icon={ScrollText}
              title="Documents"
              description="Upload documents and track ingestion status."
              href="/rag/documents"
            />
            <ExploreCard
              icon={Search}
              title="Ask"
              description="Query your documents and get citation-backed answers."
              href="/rag/ask"
            />
            <ExploreCard
              icon={Activity}
              title="Analytics"
              description="Retrieval + answer usage for this workspace."
              href="/rag/analytics"
            />
          </div>
        </section>
      </div>
    </PageShell>
  );
}

interface ExploreCardProps {
  icon: typeof Boxes;
  title: string;
  description: string;
  href: string;
}

/** Single Explore card — icon + title + 1-line description + a destination button.
 * Kept inline (mirrors `pages/memory.tsx`'s ExploreCard — Rule of 3 / YAGNI). */
function ExploreCard({ icon: Icon, title, description, href }: ExploreCardProps) {
  return (
    <Card>
      <Card.Body className="space-y-2">
        <Icon className="size-5 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
        <Button variant="ghost" size="sm" onClick={() => (window.location.href = href)}>
          Open →
        </Button>
      </Card.Body>
    </Card>
  );
}
