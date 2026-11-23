import { useEffect } from 'react';
import { Card, DataTable, type DataTableColumn, EmptyState, PageShell } from '@usetheo/ui';
import { ListSkeleton } from '@/pages/lens/components/list-skeleton';
import { Alert } from '@/components/ui/alert-guard';

import { useAgents, type Agent } from '@/hooks/lens/use-agents';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { formatNumber } from '@/lib/formatting/format';

/**
 * M44 — /lens/agents. Read-only derived agent catalog (`GET /v1/dashboard/lens/agents`, M32).
 * Agents are DERIVED from ingested spans (not authored), so this page is read-only — CRUD on it
 * would be a category error (ADR-3).
 */


export function LensAgentsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Agents'), [setPageTitle]);
  useRequireAuth();

  const query = useAgents();

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
          <EmptyState
            title="No agents yet"
            description="An agent appears here once its spans carry the agent.name attribute (the OpenTelemetry agent.* convention) — or are structural Claude-Code spans (claude_code.*). Plain LLM or tool spans without either signal are not counted as agents — instrument an agent to populate this catalogue."
            action={
              <a
                href="https://docs.getloopscale.com/observability/quickstart"
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-primary underline underline-offset-4"
              >
                Instrument an agent →
              </a>
            }
          />
        ) : (
          <Card>
            <DataTable columns={columns} data={agents} rowKey={(row) => row.name} />
          </Card>
        )}
      </div>
    </PageShell>
  );
}
