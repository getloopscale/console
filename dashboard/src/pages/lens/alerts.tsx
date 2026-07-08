import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, DataTable, type DataTableColumn, EmptyState, Input, PageShell, Select } from '@usetheo/ui';
import { ListSkeleton } from '@/components/lens/list-skeleton';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * M53 — /observability/alerts. Threshold alert rules on observability metrics. A rule
 * (metric + comparator + threshold + window + target webhook) is evaluated per-tenant by the background
 * lens_alert_evaluator; on a breach it dispatches a notification through the J-16 webhook delivery worker
 * (fire-once-until-cleared — no storm). CRUD via `/v1/dashboard/lens/alert-rules`.
 */

interface AlertRule {
  id: string;
  name: string;
  metric: string;
  comparator: string;
  threshold: number;
  window_seconds: number;
  webhook_id: string;
  enabled: boolean;
  status: string;
  last_evaluated_at: string | null;
  last_triggered_at: string | null;
}
/**
 * The honest status→badge-variant map (issue #alerts-badge): a badge must reflect the rule's TRUE
 * state, not "TRIGGERED-or-green". A disabled rule is neutral (grey), a cleared rule is success, a
 * firing rule is destructive, and an unknown status is neutral — never a misleading green "success".
 */
export function alertStatusVariant(status: string, enabled: boolean): 'destructive' | 'success' | 'outline' {
  if (!enabled) return 'outline'; // a disabled rule is not "OK/success" — it is inert
  if (status === 'TRIGGERED') return 'destructive';
  if (status === 'OK') return 'success';
  return 'outline'; // unknown / pending → neutral, never a fabricated success
}

interface AlertRulesResult {
  alert_rules: AlertRule[];
}
interface WorkspaceWebhook {
  id: string;
  url?: string;
  label?: string;
}
interface WebhooksResult {
  webhooks: WorkspaceWebhook[];
}

const METRICS = [
  { value: 'error_rate', label: 'Error rate (%)' },
  { value: 'cost', label: 'Cost (USD)' },
  { value: 'p95_latency', label: 'Latency p95 (ms)' },
] as const;
const COMPARATORS = [
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
] as const;
const WINDOWS = [
  { value: '3600', label: 'Last hour' },
  { value: '86400', label: 'Last 24h' },
  { value: '604800', label: 'Last 7 days' },
  { value: '2592000', label: 'Last 30 days' },
] as const;

export function LensAlertsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Alerts'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [metric, setMetric] = useState<string>('error_rate');
  const [comparator, setComparator] = useState<string>('gt');
  const [threshold, setThreshold] = useState('');
  const [windowSeconds, setWindowSeconds] = useState<string>('3600');
  const [webhookId, setWebhookId] = useState('');
  const [pendingDelete, setPendingDelete] = useState<AlertRule | null>(null);

  const rulesKey = ['cloud', '/v1/dashboard/lens/alert-rules'] as const;
  const rules = useQuery({
    queryKey: rulesKey,
    queryFn: () => cloudFetch<AlertRulesResult>('/v1/dashboard/lens/alert-rules'),
  });
  const webhooks = useQuery({
    queryKey: ['cloud', '/v1/settings/webhooks/list'] as const,
    queryFn: () => cloudFetch<WebhooksResult>('/v1/settings/webhooks/list'),
  });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: rulesKey });

  const create = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      cloudFetch<AlertRule>('/v1/dashboard/lens/alert-rules', { method: 'POST', body: JSON.stringify(input) }, { throwOnError: true }),
    retry: false,
    onSuccess: () => {
      setName('');
      setThreshold('');
      setWebhookId('');
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      cloudFetch<unknown>(`/v1/dashboard/lens/alert-rules/${encodeURIComponent(id)}`, { method: 'DELETE' }, { throwOnError: true }),
    retry: false,
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
    },
  });
  const toggle = useMutation({
    mutationFn: (r: AlertRule) =>
      cloudFetch<unknown>(
        `/v1/dashboard/lens/alert-rules/${encodeURIComponent(r.id)}`,
        { method: 'PATCH', body: JSON.stringify({ enabled: !r.enabled }) },
        { throwOnError: true },
      ),
    retry: false,
    onSuccess: invalidate,
  });

  // M72 — a write-action must not fail silently. Surface the first failing mutation's error.
  const writeError = create.isError ? 'create' : toggle.isError ? 'toggle' : remove.isError ? 'delete' : null;

  const availableWebhooks = webhooks.data?.webhooks ?? [];
  const canCreate = name.trim() !== '' && threshold.trim() !== '' && webhookId !== '' && !create.isPending;

  const columns: DataTableColumn<AlertRule>[] = [
    { key: 'name', label: 'Name', render: (r) => <span className="font-medium">{r.name}</span> },
    {
      key: 'rule',
      label: 'Rule',
      render: (r) => (
        <span className="font-mono text-xs">
          {r.metric} {COMPARATORS.find((c) => c.value === r.comparator)?.label ?? r.comparator} {r.threshold}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <Badge variant={alertStatusVariant(r.status, r.enabled)}>{r.enabled ? r.status : 'Disabled'}</Badge>,
    },
    {
      key: 'enabled',
      label: 'Enabled',
      render: (r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => toggle.mutate(r)}
          aria-label={`Toggle ${r.name}`}
          aria-pressed={r.enabled}
        >
          {r.enabled ? 'On' : 'Off'}
        </Button>
      ),
    },
    {
      key: 'last_triggered_at',
      label: 'Last triggered',
      render: (r) => <span className="text-xs text-muted-foreground">{r.last_triggered_at ?? '—'}</span>,
    },
    {
      key: 'actions',
      label: '',
      render: (r) => (
        <Button variant="ghost" size="sm" onClick={() => setPendingDelete(r)} aria-label={`Delete ${r.name}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      ),
    },
  ];

  const rows = rules.data?.alert_rules ?? [];

  return (
    <>
      <PageShell title="Alerts" description="Get notified when a metric crosses a threshold.">
        <div className="space-y-6">
          {writeError ? (
            <Alert
              intent="destructive"
              title={`Could not ${writeError} the alert rule`}
              description="The change was not saved — try again, or check your access to this workspace."
              data-testid="alerts-write-error"
            />
          ) : null}
          <Card>
            <Card.Header>
              <h2 className="text-sm font-medium">Create an alert rule</h2>
            </Card.Header>
            <Card.Body>
              {availableWebhooks.length === 0 ? (
                <Alert intent="warning" title="Register a webhook first">
                  Alerts are delivered to a registered webhook. Add one under{' '}
                  <Link to="/settings/webhooks" className="font-medium text-primary underline underline-offset-2">
                    Settings › Webhooks →
                  </Link>
                  , then create a rule here.
                </Alert>
              ) : (
                <form
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!canCreate) return;
                    create.mutate({
                      name: name.trim(),
                      metric,
                      comparator,
                      threshold: Number(threshold),
                      window_seconds: Number(windowSeconds),
                      webhook_id: webhookId,
                    });
                  }}
                >
                  <div className="min-w-[160px] flex-1">
                    <label htmlFor="rule-name" className="mb-1 block text-xs font-medium text-muted-foreground">
                      Name
                    </label>
                    <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="High error rate" aria-label="Rule name" />
                  </div>
                  <div>
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">Metric</span>
                    <Select value={metric} onValueChange={setMetric}>
                      <Select.Trigger className="w-[160px]" aria-label="Metric">
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Content>
                        {METRICS.map((m) => (
                          <Select.Item key={m.value} value={m.value}>
                            {m.label}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </div>
                  <div>
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">When</span>
                    <Select value={comparator} onValueChange={setComparator}>
                      <Select.Trigger className="w-[80px]" aria-label="Comparator">
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Content>
                        {COMPARATORS.map((c) => (
                          <Select.Item key={c.value} value={c.value}>
                            {c.label}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </div>
                  <div>
                    <label htmlFor="rule-threshold" className="mb-1 block text-xs font-medium text-muted-foreground">
                      Threshold
                    </label>
                    <Input
                      id="rule-threshold"
                      type="number"
                      className="w-[110px]"
                      value={threshold}
                      onChange={(e) => setThreshold(e.target.value)}
                      placeholder="5"
                      aria-label="Threshold"
                    />
                  </div>
                  <div>
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">Over</span>
                    <Select value={windowSeconds} onValueChange={setWindowSeconds}>
                      <Select.Trigger className="w-[140px]" aria-label="Window">
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Content>
                        {WINDOWS.map((wnd) => (
                          <Select.Item key={wnd.value} value={wnd.value}>
                            {wnd.label}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </div>
                  <div>
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">Notify</span>
                    <Select value={webhookId || undefined} onValueChange={setWebhookId}>
                      <Select.Trigger className="w-[200px]" aria-label="Notify webhook">
                        <Select.Value placeholder="Select a webhook" />
                      </Select.Trigger>
                      <Select.Content>
                        {availableWebhooks.map((wh) => (
                          <Select.Item key={wh.id} value={wh.id}>
                            {wh.label ?? wh.url ?? wh.id}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </div>
                  <Button type="submit" disabled={!canCreate}>
                    Create rule
                  </Button>
                </form>
              )}
            </Card.Body>
          </Card>

          {rules.isLoading ? (
            <ListSkeleton label="alert rules" />
          ) : rules.isError ? (
            <Alert intent="warning" title="Could not load alert rules">
              The lens service is unavailable. Try again shortly.
            </Alert>
          ) : rows.length === 0 ? (
            <EmptyState title="No alert rules yet" description="Create a rule above to get notified on a threshold breach." />
          ) : (
            <Card>
              <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />
            </Card>
          )}
        </div>
      </PageShell>

      {pendingDelete !== null ? (
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          title={`Delete rule "${pendingDelete.name}"?`}
          description={<p className="text-sm">This removes the alert rule. No further notifications will fire for it.</p>}
          confirmLabel={remove.isPending ? 'Deleting…' : 'Delete rule'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={remove.isPending}
          onConfirm={() => remove.mutate(pendingDelete.id)}
        />
      ) : null}
    </>
  );
}
