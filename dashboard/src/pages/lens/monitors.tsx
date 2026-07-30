import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, ShieldAlert, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  CopyButton,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  Label,
  PageShell,
  Select,
  type Severity,
  SeverityBadge,
  Skeleton,
} from '@usetheo/ui';
import { AppModal } from '@/components/ui/app-modal';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { ListSkeleton } from '@/components/lens/list-skeleton';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { formatDate, shortId } from '@/lib/format';
import { cloudFetch } from '@/lib/api';
import { alertSeverity } from './alerts';

/**
 * M44 — /lens/monitors. List / create / delete monitors via the read+write lens management BFF
 * (`/v1/dashboard/lens/monitors`). The create body matches theo-lens:
 * {evaluatorId, operator:"lt"|"lte"|"gt"|"gte"|"eq"|"label_eq", threshold?}.
 */

interface Monitor {
  id: string;
  evaluatorId?: string;
  operator?: string;
  threshold?: number;
}
interface MonitorsResult {
  monitors: Monitor[];
}
interface Evaluator {
  id: string;
  name: string;
}
interface EvaluatorsResult {
  evaluators: Evaluator[];
}

/**
 * theo-cloud#259 — the slice of an alert rule this screen needs to show a monitor's live state.
 *
 * A monitor lives in theo-lens; the state of the thing that WATCHES it lives here, in theo-cloud's
 * `lens_alert_rules` (the M135 evaluator writes `status` / `last_evaluated_at` on its 60s tick).
 * `stale` is derived server-side — the rule is enabled but has gone unevaluated for several ticks —
 * and the client cannot compute it, because the cadence is not published.
 */
interface MonitorRule {
  monitor_id?: string;
  enabled: boolean;
  status: string;
  stale: boolean;
  last_evaluated_at: string | null;
}
interface AlertRulesResult {
  alert_rules: MonitorRule[];
}

/** What the Status cell renders for one monitor. */
interface MonitorState {
  severity: Severity;
  label: string;
}

/**
 * theo-cloud#259 — the honest state of a monitor, extending `alertSeverity` (alerts.tsx) with the
 * three cases that exist for a MONITOR but not for a rule seen on its own.
 *
 * Every branch that is not a measured, current, cleared evaluation must say so. The M135 risk
 * register named this exact failure "two sources of truth": the scheduler holds a severity and the
 * screen shows something else. A green "OK" is only ever earned by an enabled, fresh, cleared rule.
 */
export function monitorState(rule: MonitorRule | undefined, rulesFailed: boolean): MonitorState {
  // An outage is not an answer. Claiming "Not monitored" from a failed read would report absence of
  // coverage that we simply could not see (error-handling.md — never a magic value for a failure).
  if (rulesFailed) return { severity: 'unknown', label: 'Unknown' };
  // No rule points at this monitor: nothing evaluates it, so no breach can ever fire. This is the
  // case the screen was silently missing — it is NOT health.
  if (!rule) return { severity: 'unknown', label: 'Not monitored' };
  // Checked before `stale` on purpose: a paused rule is not evaluated by design, so reporting it
  // stale would blame the tick for an operator's own decision.
  if (!rule.enabled) return { severity: 'paused', label: 'Disabled' };
  // The tick stopped. The last known status is the most dangerous thing to show here — a rule that
  // died while OK looks perfectly healthy, which is the outage this whole feature exists to catch.
  if (rule.stale) return { severity: 'warning', label: 'Stale' };
  return { severity: alertSeverity(rule.status, rule.enabled), label: rule.status };
}

// The monitor operators theo-lens accepts. `label_eq` matches a label string (no numeric threshold);
// the others compare the evaluator score to a threshold.
const OPERATORS = [
  { value: 'gte', label: '≥ threshold' },
  { value: 'gt', label: '> threshold' },
  { value: 'lte', label: '≤ threshold' },
  { value: 'lt', label: '< threshold' },
  { value: 'eq', label: '= threshold' },
  { value: 'label_eq', label: 'matches label' },
] as const;

export function LensMonitorsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Monitors'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [evaluatorId, setEvaluatorId] = useState('');
  // Create is a centered modal (AppModal), consistent with the rest of the dashboard — replaces the
  // former inline Card form (Evaluate UX standardization: forms open as centered modals, never inline/lateral).
  const [createOpen, setCreateOpen] = useState(false);
  const [operator, setOperator] = useState<string>('gte');
  const [threshold, setThreshold] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Monitor | null>(null);
  // M77 — the guard whose breaches are open in the side panel (null = closed).
  const [activeMonitor, setActiveMonitor] = useState<Monitor | null>(null);

  // `label_eq` matches a label, so it takes NO numeric threshold — the field is hidden + omitted.
  const needsThreshold = operator !== 'label_eq';

  // #261 — `throwOnError` here for the SAME reason it is on `rulesQuery` below, and its absence had
  // the same shape of consequence: a 502 resolved to `null`, the query reported SUCCESS, `monitors`
  // fell back to `[]`, and the screen rendered "No monitors yet — Create your first monitor". The
  // operator reads "you have none" when the truth is "I could not ask" — and a monitor may exist and
  // be firing. The `query.isError` branch below already existed and was UNREACHABLE, which is what
  // made the code read as correct.
  //
  // The comment two blocks down already spelled this rule out; these two queries simply did not
  // follow it. Same movement as #250 did for Memories.
  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/monitors'] as const,
    queryFn: () => cloudFetch<MonitorsResult>('/v1/dashboard/lens/monitors', {}, { throwOnError: true }),
    retry: false,
  });
  // #179 — the evaluator is chosen from the workspace's evaluators (by name), not typed as a raw id
  // the Evaluators screen never surfaced. value = id, label = name.
  const evaluatorsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/evaluators'] as const,
    queryFn: () => cloudFetch<EvaluatorsResult>('/v1/dashboard/lens/evaluators', {}, { throwOnError: true }),
    retry: false,
  });
  const evaluators = evaluatorsQuery.data?.evaluators ?? [];
  const evaluatorName = (id?: string) => evaluators.find((e) => e.id === id)?.name ?? (id ? shortId(id) : '—');

  // #259 — the live state of each monitor. Read from the SAME endpoint the Alerts screen uses, so the
  // two surfaces cannot disagree about a rule (Rule 9 — the route already returns status,
  // last_evaluated_at and the derived `stale`, keyed by monitor_id; nothing new was persisted for this).
  //
  // `throwOnError` is NOT optional here. `cloudFetch` defaults to `T | null` and does NOT throw, so
  // without it a 502 resolves to `null`, the query reports SUCCESS, and every monitor renders
  // "Not monitored" — the screen would assert, from an outage, that nothing is watching. That is the
  // precise failure the Unknown state exists to prevent, and it survived the unit tests because the
  // mock throws where the real client returns null. Found by driving the live stack (#259).
  const rulesQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/alert-rules'] as const,
    queryFn: () => cloudFetch<AlertRulesResult>('/v1/dashboard/lens/alert-rules', {}, { throwOnError: true }),
    retry: false,
  });
  // Last rule wins per monitor. Two rules on one monitor is legal and rare; picking one arbitrarily is
  // honest only because every state below is derived from the rule shown — never merged across rules.
  const ruleByMonitor = new Map<string, MonitorRule>();
  for (const r of rulesQuery.data?.alert_rules ?? []) {
    if (r.monitor_id) ruleByMonitor.set(r.monitor_id, r);
  }

  // M77 — a human rule string for the breaches panel (numeric operators as symbols; label_eq spelled out).
  const OP_SYMBOL: Record<string, string> = { gte: '≥', gt: '>', lte: '≤', lt: '<', eq: '=' };
  const guardRuleText = (g: Monitor) =>
    g.operator === 'label_eq'
      ? `Traces failing ${evaluatorName(g.evaluatorId)} (label match)`
      : `Traces failing ${evaluatorName(g.evaluatorId)} ${OP_SYMBOL[g.operator ?? ''] ?? g.operator ?? ''} ${g.threshold ?? ''}`.trim();

  // M77 — the breaches read (flag-only: `{ traceIds }`) for the open guard. Fetched on demand only.
  const breachesQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/monitors', activeMonitor?.id, 'breaches'] as const,
    queryFn: () =>
      cloudFetch<{ traceIds: string[] }>(`/v1/dashboard/lens/monitors/${encodeURIComponent(activeMonitor!.id)}/breaches`, {}, { throwOnError: true }),
    enabled: activeMonitor !== null,
  });
  const breachTraceIds = breachesQuery.data?.traceIds ?? [];

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/monitors'] });

  const create = useMutation({
    mutationFn: (input: { evaluatorId: string; operator: string; threshold?: number }) =>
      cloudFetch<Monitor>('/v1/dashboard/lens/monitors', {
        method: 'POST',
        body: JSON.stringify(
          // omit threshold entirely for a label match (no fabricated 0)
          input.threshold === undefined
            ? { evaluatorId: input.evaluatorId, operator: input.operator }
            : { evaluatorId: input.evaluatorId, operator: input.operator, threshold: input.threshold },
        ),
      }),
    onSuccess: () => {
      setEvaluatorId('');
      setOperator('gte');
      setThreshold('');
      setCreateOpen(false);
      invalidate();
    },
  });

  // Reset the create form + clear any error, then close the modal (every close path).
  const closeCreate = () => {
    setCreateOpen(false);
    setEvaluatorId('');
    setOperator('gte');
    setThreshold('');
    create.reset();
  };

  // Submit the create form (shared by the footer button + Enter on the threshold field).
  const submitCreate = () => {
    if (!evaluatorId) return;
    if (needsThreshold) {
      const t = Number(threshold);
      if (threshold.trim() === '' || Number.isNaN(t)) return;
      create.mutate({ evaluatorId, operator, threshold: t });
    } else {
      create.mutate({ evaluatorId, operator }); // label_eq — no threshold
    }
  };

  const remove = useMutation({
    mutationFn: (g: Monitor) =>
      cloudFetch<null>(`/v1/dashboard/lens/monitors/${encodeURIComponent(g.id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
    },
  });

  const columns: DataTableColumn<Monitor>[] = [
    {
      key: 'evaluatorId',
      label: 'Evaluator',
      render: (row) =>
        row.evaluatorId ? (
          <div className="flex items-center gap-1">
            <span className="font-mono text-sm" title={row.evaluatorId}>
              {shortId(row.evaluatorId)}
            </span>
            <CopyButton value={row.evaluatorId} label="Copy evaluator id" />
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: 'operator', label: 'Operator', render: (row) => <span>{row.operator ?? '—'}</span> },
    { key: 'threshold', label: 'Threshold', render: (row) => <span>{row.threshold ?? '—'}</span> },
    {
      // #259 — the severity the M135 scheduler is holding. Without this the screen could not
      // distinguish "cleared", "firing", "nobody is watching" and "the tick died".
      key: 'severity',
      label: 'Status',
      render: (row) => {
        const s = monitorState(ruleByMonitor.get(row.id), rulesQuery.isError);
        return (
          <span data-testid={`monitor-severity-${row.id}`}>
            <SeverityBadge severity={s.severity} label={s.label} />
          </span>
        );
      },
    },
    {
      // #259 — when the tick last looked. `formatDate` collapses null / empty / zero-time to an
      // em-dash, so an unevaluated monitor shows absence instead of a fabricated timestamp.
      key: 'last_evaluated_at',
      label: 'Last evaluated',
      render: (row) => (
        <span data-testid={`monitor-last-evaluated-${row.id}`} className="text-xs text-muted-foreground">
          {rulesQuery.isError ? '—' : formatDate(ruleByMonitor.get(row.id)?.last_evaluated_at, 'relative')}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setActiveMonitor(row)} aria-label={`View breaches for ${evaluatorName(row.evaluatorId)}`}>
            <ShieldAlert className="mr-1 h-4 w-4" /> View breaches
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPendingDelete(row)} aria-label={`Delete ${row.id}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const monitors = query.data?.monitors ?? [];

  return (
    <>
      <PageShell
        title="Monitors"
        description="Alert when evaluator scores cross a threshold."
        primaryAction={{ label: 'New monitor', icon: Plus, onClick: () => setCreateOpen(true) }}
      >
        <div className="space-y-6">
          {query.isLoading ? (
            <ListSkeleton label="monitors" />
          ) : query.isError ? (
            <Alert intent="warning" title="Could not load monitors">
              The lens service is unavailable. Try again shortly.
            </Alert>
          ) : monitors.length === 0 ? (
            <EmptyState
              title="No monitors yet"
              description="Create your first monitor to be alerted when scores cross a threshold."
              action={
                <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
                  Create your first monitor
                </Button>
              }
            />
          ) : (
            <Card>
              <DataTable columns={columns} data={monitors} rowKey={(row) => row.id} />
            </Card>
          )}
        </div>
      </PageShell>

      <AppModal
        open={createOpen}
        onClose={closeCreate}
        size="md"
        title="New monitor"
        description="Alert when an evaluator score crosses a threshold."
        footer={
          <>
            <Button variant="secondary" onClick={closeCreate}>
              Cancel
            </Button>
            <Button
              onClick={submitCreate}
              disabled={!evaluatorId || (needsThreshold && threshold.trim() === '') || create.isPending}
            >
              {create.isPending ? 'Creating…' : 'Create guard'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="monitor-evaluator">Evaluator</Label>
            <Select value={evaluatorId} onValueChange={setEvaluatorId}>
              <Select.Trigger id="monitor-evaluator" className="w-full" aria-label="Evaluator">
                {/*
                  #261 — an empty list and a FAILED read are different facts and must not share copy.
                  "No evaluators — create one first" told the operator to create something that may
                  already exist, from an outage. `evaluatorsQuery.isError` is only reachable at all
                  because the query above now opts into `throwOnError`.
                */}
                <Select.Value
                  placeholder={
                    evaluatorsQuery.isError
                      ? 'Could not load evaluators'
                      : evaluators.length === 0
                        ? 'No evaluators — create one first'
                        : 'Choose an evaluator'
                  }
                />
              </Select.Trigger>
              <Select.Content>
                {evaluators.map((ev) => (
                  <Select.Item key={ev.id} value={ev.id}>
                    {ev.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <div>
            <Label htmlFor="monitor-operator">Operator</Label>
            <Select value={operator} onValueChange={setOperator}>
              <Select.Trigger id="monitor-operator" className="w-full" aria-label="Operator">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {OPERATORS.map((op) => (
                  <Select.Item key={op.value} value={op.value}>
                    {op.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          {needsThreshold ? (
            <div>
              <Label htmlFor="monitor-threshold">Threshold</Label>
              <Input
                id="monitor-threshold"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCreate();
                }}
                placeholder="0.5"
              />
            </div>
          ) : null}
          {evaluatorsQuery.isError ? (
            <Alert intent="warning" title="Could not load evaluators">
              The list above is incomplete — this is an outage, not an empty workspace. Try again shortly.
            </Alert>
          ) : null}
          {create.isError ? (
            <Alert intent="destructive" title="Could not create the guard">
              Try again shortly.
            </Alert>
          ) : null}
        </div>
      </AppModal>

      {pendingDelete ? (
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          title={`Delete guard ${pendingDelete.id}?`}
          description={<p className="text-sm">This permanently deletes the monitor. This cannot be undone.</p>}
          confirmLabel={remove.isPending ? 'Deleting…' : 'Delete guard'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={remove.isPending}
          onConfirm={() => remove.mutate(pendingDelete)}
        />
      ) : null}

      {/* M77 — the breaches panel: what this guard actually gated. The read is flag-only ({traceIds}),
          so we list the breaching traces (deep-linked to their peek) and frame them with the guard's own
          rule — never a fabricated per-breach score/time. A centered modal (AppModal), not a lateral Sheet. */}
      <AppModal
        open={activeMonitor !== null}
        onClose={() => setActiveMonitor(null)}
        size="lg"
        title={activeMonitor ? `Breaches · ${evaluatorName(activeMonitor.evaluatorId)}` : 'Monitor breaches'}
        description={activeMonitor ? guardRuleText(activeMonitor) : ''}
      >
        <div className="space-y-3">
          {breachesQuery.isPending ? (
            <Skeleton className="h-24 w-full" aria-label="Loading breaches" />
          ) : breachesQuery.isError ? (
            <Alert intent="warning" title="Could not load breaches" data-testid="breaches-error">
              The lens service is unavailable. Try again shortly.
            </Alert>
          ) : breachTraceIds.length === 0 ? (
            <EmptyState title="No breaches yet" description="No trace has breached this monitor." />
          ) : (
            <ul className="space-y-1">
              {breachTraceIds.map((tid) => (
                <li key={tid} className="flex items-center gap-2">
                  <Link
                    to={`/observability/traces?trace=${encodeURIComponent(tid)}`}
                    className="font-mono text-xs text-primary underline underline-offset-2"
                    aria-label={`Open trace ${tid}`}
                  >
                    {shortId(tid)}
                  </Link>
                  <CopyButton value={tid} label="Copy trace id" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </AppModal>
    </>
  );
}
