import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, DataTable, type DataTableColumn, EmptyState, PageShell } from '@usetheo/ui';
import { ListSkeleton } from '@/components/lens/list-skeleton';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';
import { formatNumber } from '@/lib/format';

/**
 * M44 — /lens/agents. Read-only derived agent catalog (`GET /v1/dashboard/lens/agents`, M32).
 * Agents are DERIVED from ingested spans (not authored), so this page is read-only — CRUD on it
 * would be a category error (ADR-3).
 */

interface Agent {
  name: string;
  traceCount?: number;
}
interface AgentsResult {
  agents: Agent[];
}

export function LensAgentsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Agents'), [setPageTitle]);
  useRequireAuth();

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/agents'] as const,
    queryFn: () => cloudFetch<AgentsResult>('/v1/dashboard/lens/agents'),
  });

  const columns: DataTableColumn<Agent>[] = [
    { key: 'name', label: 'Agent', render: (row) => <span>{row.name}</span> },
    // An absent count is unknown → em-dash; a real 0 stays 0; a present count is grouped (1,234).
    { key: 'traceCount', label: 'Traces', render: (row) => <span>{row.traceCount != null ? formatNumber(row.traceCount, 'grouped') : '—'}</span> },
  ];

  const agents = query.data?.agents ?? [];

  return (
    <PageShell title="Agents" description="The derived catalog of instrumented agents (read-only).">
      <div className="space-y-6">
        {query.isLoading ? (
          <ListSkeleton label="agents" />
        ) : query.isError ? (
          <Alert intent="warning" title="Could not load agents">
            The lens service is unavailable. Try again shortly.
          </Alert>
        ) : agents.length === 0 ? (
          <EmptyState title="No agents yet" description="Agents appear once instrumented executions are ingested." />
        ) : (
          <Card>
            <DataTable columns={columns} data={agents} rowKey={(row) => row.name} />
          </Card>
        )}
      </div>
    </PageShell>
  );
}
