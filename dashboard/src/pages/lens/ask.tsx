import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, EmptyState, PageShell, Skeleton } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';
import type { TraceSpanNode } from '@/pages/lens/trace-layout';
import { AskThread } from '@/components/lens/ask-thread';

/**
 * M61 — /observability/ask. The Ask copilot as a persistent conversation **docked to the open trace**
 * (Opik `TraceAIViewer` model; blueprint §6). The trace context is carried in the URL (`?traceId=` +
 * optional `?spanId=`) from the traces list / detail's "Ask copilot" affordance — there is NO manual
 * trace-id entry (the M44 stub's `Input` is gone). The page fetches the trace tree (the reused M58
 * read — Rule 9) to build the span-citation entity map, then renders the client-side `<AskThread>`.
 */
export function LensAskPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Ask'), [setPageTitle]);
  useRequireAuth();

  const [params] = useSearchParams();
  const traceId = params.get('traceId') ?? '';
  const spanId = params.get('spanId') ?? undefined;

  // Reused M58 trace fetch (Rule 9 — no new endpoint) → the span tree for the entity map.
  const tree = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/traces', traceId] as const,
    queryFn: () => cloudFetch<TraceSpanNode>(`/v1/dashboard/lens/traces/${encodeURIComponent(traceId)}`, {}, { throwOnError: true }),
    enabled: traceId !== '',
  });

  return (
    <PageShell title="Ask" description="Ask the copilot about the open trace — a grounded conversation.">
      <div className="space-y-6">
        {traceId === '' ? (
          <EmptyState
            title="Open a trace and click Ask"
            description="The copilot is grounded in a trace — open one from Traces and use its “Ask copilot” action. No id to type."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link to="/observability/traces">Browse traces →</Link>
              </Button>
            }
          />
        ) : tree.isPending ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : tree.isError ? (
          <Alert intent="warning" title="Could not load this trace">
            The lens service is unavailable, or this trace is not in your workspace. Try again shortly.
          </Alert>
        ) : (
          <AskThread traceId={traceId} spans={tree.data ?? undefined} initialSpanId={spanId} />
        )}
      </div>
    </PageShell>
  );
}
