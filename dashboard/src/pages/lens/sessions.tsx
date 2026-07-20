import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button, Card, CopyButton, DataTable, type DataTableColumn, EmptyState, PageShell } from '@usetheo/ui';
import { ListSkeleton } from '@/components/lens/list-skeleton';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { formatCost, formatDate, formatDuration, formatTokens, shortId } from '@/lib/format';
import { cloudFetch } from '@/lib/api';

/**
 * M44 — /lens/sessions. Read-only session replay list (`GET /v1/dashboard/lens/sessions`).
 * Sessions are aggregates recomputed from ingested spans — there is NO mutating route for the
 * session body (ADR-2/3); replay is a read.
 */

interface Session {
  sessionId: string;
  traceCount?: number;
  // M54 — the aggregate fields the lens ALREADY returns (session-list DTO). Rendered so a session is
  // identifiable without opening it (SOTA parity). All optional → honest em-dash when absent.
  lastSeenAt?: string;
  costUsd?: number;
  totalTokens?: number;
  errorRate?: number;
  firstMessagePreview?: string;
  // M131 — Arize-parity residual columns. Last assistant reply (bookend of first message), session
  // span-time duration, and best-effort user id. All optional → honest em-dash when absent.
  lastMessagePreview?: string;
  durationMs?: number;
  userId?: string;
}
interface SessionsResult {
  sessions: Session[];
  // M81 — server-side pagination envelope.
  total?: number;
}

/** M81 — the sessions page window. */
const SESSIONS_PAGE_SIZE = 50;

export function LensSessionsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Sessions'), [setPageTitle]);
  useRequireAuth();

  // M81 — server-side pagination (the engine now honors limit/offset + returns a workspace-scoped total).
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/sessions', page] as const,
    queryFn: () =>
      cloudFetch<SessionsResult>(
        `/v1/dashboard/lens/sessions?limit=${SESSIONS_PAGE_SIZE}&offset=${(page - 1) * SESSIONS_PAGE_SIZE}`,
      ),
  });
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / SESSIONS_PAGE_SIZE));
  const firstShown = total === 0 ? 0 : (page - 1) * SESSIONS_PAGE_SIZE + 1;
  const lastShown = Math.min(page * SESSIONS_PAGE_SIZE, total);

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
    // M54 — first user message: the single most identifying signal for a session (SOTA). Truncated
    // by the lens; absent (no/blank root input) → em-dash.
    {
      key: 'firstMessagePreview',
      label: 'First message',
      render: (row) =>
        row.firstMessagePreview ? (
          <span className="block max-w-[22rem] truncate text-sm text-muted-foreground" title={row.firstMessagePreview}>
            {row.firstMessagePreview}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    // M131 — Last message: the session's final assistant reply, bookend of First message. Truncated,
    // em-dash when absent. Same visual as First message.
    {
      key: 'lastMessagePreview',
      label: 'Last message',
      render: (row) =>
        row.lastMessagePreview ? (
          <span className="block max-w-[22rem] truncate text-sm text-muted-foreground" title={row.lastMessagePreview}>
            {row.lastMessagePreview}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'lastSeenAt',
      label: 'Last active',
      render: (row) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {row.lastSeenAt ? formatDate(row.lastSeenAt, 'relative') : '—'}
        </span>
      ),
    },
    // M131 — Duration: session span-time (first→last span), humanized; em-dash when unknown.
    {
      key: 'durationMs',
      label: 'Duration',
      align: 'right',
      render: (row) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {row.durationMs != null ? formatDuration(row.durationMs) : '—'}
        </span>
      ),
    },
    // M131 — User: best-effort user id from span attributes; em-dash when absent (never fabricated).
    {
      key: 'userId',
      label: 'User',
      render: (row) =>
        row.userId ? (
          <span className="font-mono text-xs" title={row.userId}>
            {row.userId}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    // An absent count is unknown → em-dash; a real 0 stays 0.
    { key: 'traceCount', label: 'Traces', align: 'right', render: (row) => <span className="tabular-nums">{row.traceCount != null ? row.traceCount : '—'}</span> },
    { key: 'totalTokens', label: 'Tokens', align: 'right', render: (row) => <span className="tabular-nums text-xs">{row.totalTokens != null ? formatTokens(row.totalTokens) : '—'}</span> },
    { key: 'costUsd', label: 'Cost', align: 'right', render: (row) => <span className="tabular-nums text-xs">{row.costUsd != null ? formatCost(row.costUsd) : '—'}</span> },
    {
      key: 'errorRate',
      label: 'Errors',
      align: 'right',
      // A healthy session (rate 0 / absent) shows an em-dash — no red noise; a session with errors
      // shows the rate in the destructive tone so it stands out in a scan.
      render: (row) =>
        row.errorRate != null && row.errorRate > 0 ? (
          <span className="tabular-nums text-xs text-destructive">{Math.round(row.errorRate * 100)}%</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      // M9 — the primary action opens the session detail (aggregate metrics + temporal replay). The
      // secondary "View traces" keeps the pre-filtered traces-list jump (`?session=`) for users who
      // want the full filterable table rather than the replay.
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link to={`/observability/sessions/${encodeURIComponent(row.sessionId)}`}>Open session</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to={`/observability/traces?session=${encodeURIComponent(row.sessionId)}`}>View traces</Link>
          </Button>
        </div>
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
            description="Sessions group traces that share a session.id attribute (or the OpenInference gen_ai.conversation.id). Instrument an agent with the Theo SDK — set session.id on your spans — to start."
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
          <>
            {total > 0 ? (
              <p data-testid="sessions-count" className="mb-1 text-xs text-muted-foreground">{`Showing ${firstShown}–${lastShown} of ${total}`}</p>
            ) : null}
            <Card>
              <DataTable columns={columns} data={sessions} rowKey={(row) => row.sessionId} />
            </Card>
            {/* M81 — server-side pager (mirrors the M70 labeling-queue). */}
            {pageCount > 1 ? (
              <div className="mt-3 flex items-center justify-end gap-2 text-sm text-muted-foreground">
                <Button variant="ghost" size="sm" disabled={page <= 1 || query.isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Previous
                </Button>
                <span className="tabular-nums" data-testid="sessions-pager">{`Page ${page} / ${pageCount}`}</span>
                <Button variant="ghost" size="sm" disabled={page >= pageCount || query.isFetching} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </PageShell>
  );
}
