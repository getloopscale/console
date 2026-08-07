import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, PageShell, TraceCompare } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';
import { formatCost } from '@/lib/formatting/format';
import { type TraceSpanNode } from './trace-detail/helpers';
import { toTraceSpan } from './trace-detail/to-trace-span';

/**
 * M54 / M8 — /observability/compare?ids=A,B. Compare two traces side by side. The side-by-side lanes,
 * the metrics header, and the structural diff table now come from `@usetheo/ui` `TraceCompare` (honest
 * deltas: unmatched spans are marked "only in A/B" and their delta is suppressed — no fabricated 1:1
 * diff). This page keeps the consumer-owned concerns: auth, the `?ids=` URL, the two fetches, and the
 * "pick two traces" empty state. The DS receives DATA (mapped lanes), never routes or fetches (ADR D1).
 */

interface LaneData {
  id: string;
  tree: TraceSpanNode | undefined;
  pending: boolean;
  error: boolean;
}

function useLane(id: string | undefined): LaneData {
  const treeQ = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/traces', id, 'tree'] as const,
    queryFn: () => cloudFetch<TraceSpanNode>(`/v1/dashboard/lens/traces/${encodeURIComponent(id!)}`, {}, { throwOnError: true }),
    enabled: !!id,
  });
  // O fetch de `/cost` por lane foi REMOVIDO aqui (#274). Ele existia "so a future richer lane can use
  // it" — resultado descartado, nenhum consumidor: duas requisições por comparação, custeadas em
  // latência e em quota do BFF, para alimentar ninguém. A escada de parcimônia responde no primeiro
  // degrau: código que não precisa existir não precisa de `throwOnError`, precisa sair. O header da
  // lane já agrega o `costUsd` por span que a árvore mapeada carrega, então nada visível muda.
  return {
    id: id ?? '',
    tree: treeQ.data ?? undefined,
    pending: !!id && treeQ.isPending,
    error: treeQ.isError,
  };
}

/** Honest per-lane error surface — a failed/foreign trace is an Alert, never an eternal skeleton. */
function LaneError({ lane }: { lane: LaneData }) {
  return (
    <Alert intent="warning" title="Could not load this trace" data-testid={`lane-error-${lane.id}`}>
      <span className="font-mono">{lane.id}</span> is unavailable (not found in your workspace, or the
      lens service is down).
    </Alert>
  );
}

export function LensComparePage() {
  useRequireAuth();
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle?.('Compare traces'), [setPageTitle]);
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const [idA, idB] = ids;

  const laneA = useLane(idA);
  const laneB = useLane(idB);

  if (ids.length < 2) {
    return (
      <PageShell title="Compare traces" description="Pick two traces to compare their timelines and metrics.">
        <EmptyState
          title="Select two traces"
          description="Open the traces list, tick two rows, and choose Compare."
        />
      </PageShell>
    );
  }

  // A lane whose fetch failed is an honest Alert (not a comparison against an eternal skeleton).
  const anyError = laneA.error || laneB.error;

  return (
    <PageShell title="Compare traces" description="Side-by-side timelines + a metrics delta. First trace is the baseline.">
      {anyError ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {laneA.error ? <LaneError lane={laneA} /> : null}
          {laneB.error ? <LaneError lane={laneB} /> : null}
        </div>
      ) : (
        <TraceCompare
          laneA={{ id: `${laneA.id} · baseline`, root: laneA.tree ? toTraceSpan(laneA.tree) : EMPTY_ROOT, pending: laneA.pending || !laneA.tree }}
          laneB={{ id: laneB.id, root: laneB.tree ? toTraceSpan(laneB.tree) : EMPTY_ROOT, pending: laneB.pending || !laneB.tree }}
          formatCostUsd={(usd) => formatCost(usd, 4)}
        />
      )}
    </PageShell>
  );
}

// A placeholder root while a lane is still loading (pending lanes render a skeleton, so it is never
// walked — but `TraceCompare` types require a root).
const EMPTY_ROOT = { id: '', parentId: null, name: '' } as const;
