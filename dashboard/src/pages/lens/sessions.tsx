import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button, Card, CopyButton, DataTable, type DataTableColumn, EmptyState, PageShell } from '@usetheo/ui';
import { ListSkeleton } from '@/components/lens/list-skeleton';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { shortId } from '@/lib/format';
import { cloudFetch } from '@/lib/api';

/**
 * M44 — /lens/sessions. Read-only session replay list (`GET /v1/dashboard/lens/sessions`).
 * Sessions are aggregates recomputed from ingested spans — there is NO mutating route for the
 * session body (ADR-2/3); replay is a read.
 */

interface Session {
  sessionId: string;
  traceCount?: number;
}
interface SessionsResult {
  sessions: Session[];
}

export function LensSessionsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Sessions'), [setPageTitle]);
  useRequireAuth();

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/sessions'] as const,
    queryFn: () => cloudFetch<SessionsResult>('/v1/dashboard/lens/sessions'),
  });

  const columns: DataTableColumn<Session>[] = [
    {
      key: 'sessionId',
      label: 'Session',
      render: (row) =>
        row.sessionId ? (
          <div className="flex items-center gap-1">
            <span className="font-mono text-sm" title={row.sessionId}>
              {shortId(row.sessionId)}
            </span>
            <CopyButton value={row.sessionId} label="Copy session id" />
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    // An absent count is unknown → em-dash; a real 0 stays 0.
    { key: 'traceCount', label: 'Traces', render: (row) => <span>{row.traceCount != null ? row.traceCount : '—'}</span> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      // Close the dead-end: a session row jumps to the traces list pre-filtered to this session
      // (the `?session=` URL state the Traces page already reads).
      render: (row) => (
        <Button asChild variant="ghost" size="sm">
          <Link to={`/observability/traces?session=${encodeURIComponent(row.sessionId)}`}>View traces</Link>
        </Button>
      ),
    },
  ];

  const sessions = query.data?.sessions ?? [];

  return (
    <PageShell title="Sessions" description="Replay grouped executions (read-only).">
      <div className="space-y-6">
        {query.isLoading ? (
          <ListSkeleton label="sessions" />
        ) : query.isError ? (
          <Alert intent="warning" title="Could not load sessions">
            The lens service is unavailable. Try again shortly.
          </Alert>
        ) : sessions.length === 0 ? (
          <EmptyState
            title="No sessions yet"
            description="Sessions group traces that share a `session.id` attribute. Instrument an agent with the Theo SDK — set `session.id` on your spans — to start."
            action={
              <a
                href="https://docs.usetheo.dev/observability/quickstart"
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
            <DataTable columns={columns} data={sessions} rowKey={(row) => row.sessionId} />
          </Card>
        )}
      </div>
    </PageShell>
  );
}
