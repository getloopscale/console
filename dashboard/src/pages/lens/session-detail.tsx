import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, CopyButton, EmptyState, PageShell, SessionSummary, SessionTimeline, Tabs } from '@usetheo/ui';
import { ListSkeleton } from '@/pages/lens/components/list-skeleton';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { formatCost, shortId } from '@/lib/formatting/format';
import {
  useSessionTraces,
  useSessionCoherence,
  useRunSessionCoherence,
} from '@/hooks/lens/use-session-detail';
import { nsToIso } from './traces';
import type { Trace } from './traces/columns';
import { toSessionItem } from './session-detail/to-session-item';
import { SessionConversation } from './session-detail/session-conversation';

/**
 * M9 — /observability/sessions/:sessionId. The session detail screen: fetch the session's traces
 * (`GET /v1/dashboard/lens/traces?session_id=<id>` — the SAME read the traces list uses, filtered to
 * one session), map each traces-list row to the generic `SessionTraceItem` (via the pure
 * `toSessionItem` boundary mapper), and render the `@usetheo/ui` session components: `SessionSummary`
 * (aggregate metrics — trace count, wall-clock window, ∑ cost, ∑ tokens, error count, models) +
 * `SessionTimeline` (the temporal replay, one row per trace sorted by start time). The DS receives
 * DATA (mapped items), never routes or fetches (M8 ADR D1). This page owns the consumer concerns:
 * auth, the `:sessionId` URL, the fetch, and the loading→error→empty triad.
 */



/** ns (bigint) → an ISO-medium timestamp for the timeline rows, reusing the list's `nsToIso`. */
function formatTimelineTimestamp(ns: bigint): string {
  return nsToIso(ns.toString()) ?? '—';
}

export function LensSessionDetailPage() {
  const { sessionId = '' } = useParams();
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Session'), [setPageTitle]);
  useRequireAuth();

  const navigate = useNavigate();
  // M54: a timeline row click DRILLS INTO the trace (session → trace → span) — it opens the same
  // trace detail the traces list opens (`?trace=<id>`). The row is highlighted first (controlled
  // selection) so the click has an instant affordance, then we navigate.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const openTrace = (id: string) => {
    setSelectedId(id);
    navigate(`/observability/traces?trace=${encodeURIComponent(id)}`);
  };

  const query = useSessionTraces<Trace>(sessionId);

  // M131 — Session Coherence: read the cached verdict (null → not evaluated) + a mutation to run the
  // judge on demand. A read is cheap; the run is billable (rate-limited upstream), so it is explicit.
  const coherenceQuery = useSessionCoherence(sessionId);
  const runCoherence = useRunSessionCoherence(sessionId);
  const coherence = runCoherence.data ?? coherenceQuery.data;

  // Map the traces-list rows to the generic SessionTraceItem the DS components consume. Memoized so the
  // O(n) map runs only when the data changes, not on every unrelated re-render (e.g. row selection).
  const items = useMemo(
    () => (query.data?.traces ?? []).map(toSessionItem),
    [query.data?.traces],
  );

  // M132 — Timeline | Conversation tabs, deep-linkable via ?tab=conversation (mirrors trace-detail ?view=).
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'conversation' ? 'conversation' : 'timeline';
  const setTab = (v: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v === 'timeline') next.delete('tab');
        else next.set('tab', v);
        return next;
      },
      { replace: true },
    );

  return (
    <PageShell title="Session" description="Aggregate metrics and temporal replay for one session.">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            to="/observability/sessions"
            className="font-medium text-primary underline underline-offset-4"
          >
            ← Sessions
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-mono" title={sessionId}>
            {shortId(sessionId)}
          </span>
          {sessionId ? <CopyButton value={sessionId} label="Copy session id" /> : null}
          {/* M131 — Session Coherence verdict badge (destructive on incoherent, outline on coherent,
              muted "not evaluated" when null) + an explicit run/re-run of the billable judge. */}
          <div className="ml-auto flex items-center gap-2">
            {coherence?.verdict ? (
              <Badge
                variant={coherence.verdict === 'incoherent' ? 'destructive' : 'outline'}
                title={coherence.reasoning}
                aria-label={`Session coherence: ${coherence.verdict}`}
              >
                Coherence: {coherence.verdict}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">Coherence: not evaluated</span>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={runCoherence.isPending || sessionId === ''}
              onClick={() => runCoherence.mutate()}
            >
              {runCoherence.isPending ? 'Evaluating…' : coherence?.verdict ? 'Re-run' : 'Run coherence'}
            </Button>
          </div>
        </div>
        {/* M1 (review) — fail-loud on a billable run: a 429 (rate-limited) or 502 (judge unavailable)
            surfaces here instead of silently reverting the button (never burn budget on a blind retry). */}
        {runCoherence.isError ? (
          <p className="-mt-3 text-xs text-destructive" role="alert" data-testid="coherence-run-error">
            Could not run coherence — you may be rate-limited, or the evaluator is unavailable. Try again shortly.
          </p>
        ) : null}
        {/* The judge's rationale (cites the turn where coherence broke) — shown under the header. */}
        {coherence?.reasoning ? (
          <p className="-mt-3 text-xs text-muted-foreground" data-testid="coherence-reasoning">
            {coherence.reasoning}
          </p>
        ) : null}

        {query.isLoading ? (
          <ListSkeleton label="session" />
        ) : query.isError ? (
          <Alert intent="warning" title="Could not load this session">
            The lens service is unavailable, or this session is not in your workspace. Try again shortly.
          </Alert>
        ) : items.length === 0 ? (
          <EmptyState
            title="No traces in this session"
            description="This session has no traces yet — traces are grouped by a shared session.id attribute. Instrument an agent with the Theo SDK and set session.id on your spans."
            action={
              <Link
                to="/observability/traces"
                className="text-sm font-medium text-primary underline underline-offset-4"
              >
                Browse all traces →
              </Link>
            }
          />
        ) : (
          // M132 — Timeline (aggregate metrics + temporal replay) | Conversation (turn-by-turn Human→AI
          // replay). The M131 coherence badge stays in the header above, framing both tabs.
          <Tabs value={activeTab} onValueChange={setTab}>
            <Tabs.List>
              <Tabs.Trigger value="timeline">Timeline</Tabs.Trigger>
              <Tabs.Trigger value="conversation">Conversation</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="timeline">
              <div className="space-y-6 pt-4">
                <Card>
                  <SessionSummary items={items} formatCostUsd={(usd) => formatCost(usd, 4)} />
                </Card>
                <Card>
                  <SessionTimeline
                    items={items}
                    selectedId={selectedId}
                    onSelect={openTrace}
                    formatTimestamp={formatTimelineTimestamp}
                    formatCostUsd={(usd) => formatCost(usd, 4)}
                  />
                </Card>
              </div>
            </Tabs.Content>
            <Tabs.Content value="conversation">
              <div className="pt-4">
                <SessionConversation sessionId={sessionId} traces={query.data?.traces ?? []} />
              </div>
            </Tabs.Content>
          </Tabs>
        )}
      </div>
    </PageShell>
  );
}
