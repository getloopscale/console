import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCw, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  EmptyState,
  PageShell,
  Sheet,
  Timestamp,
  useToast,
} from '@usetheo/ui';
import { AddWebhookDialog } from '@/components/dialogs/add-webhook-dialog';
import { FALHA_AO_LER_ENTREGAS } from '@/pages/settings/webhook-copy';
import type { Delivery } from '@/lib/webhooks/delivery';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/http/api';
import { LIST_SAFETY_CEILING } from '@/lib/http/list-ceiling';

/**
 * Plan 3 of dashboard-memory-section-roadmap.md, T3.7.
 * Delivery Replay plan, T8.4 — adds per-delivery Replay button to a Sheet
 * listing all 10 recent deliveries per webhook.
 *
 * /memory/webhooks — webhook registration + delivery inspection UI.
 */

interface Webhook {
  id: string;
  url: string;
  label: string;
  events: string[];
  created_at?: string;
}

interface ListResult {
  webhooks: Webhook[];
}

interface DeliveriesResult {
  deliveries: Delivery[];
}

interface ReplayResult {
  id: string;
  status: 'pending' | 'delivering';
  noop: boolean;
}

function deliveryStatusVariant(s: Delivery['status']): 'default' | 'success' | 'warning' | 'destructive' {
  switch (s) {
    case 'pending':
    case 'delivering':
      return 'warning';
    case 'delivered':
      return 'success';
    case 'failed':
      return 'default';
    case 'dead_letter':
      return 'destructive';
  }
}

// Replay button is visible ONLY for these statuses (D5 of the plan).
// `delivered` would create a duplicate; `pending|delivering` would be a no-op
// the customer doesn't need to trigger manually.
function canReplay(s: Delivery['status']): boolean {
  return s === 'failed' || s === 'dead_letter';
}

const AVAILABLE_EVENTS = [
  { id: 'memory.remembered', label: 'memory.remembered' },
  { id: 'memory.forgotten', label: 'memory.forgotten' },
  { id: 'memory.exported', label: 'memory.exported' },
] as const;

export function WebhooksPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Webhooks'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['cloud', '/v1/dashboard/memory/webhooks/list'] as const,
    // throwOnError so a failed fetch is query.isError, not an empty list rendered
    // as "no webhooks" (theo-cloud#250).
    queryFn: () =>
      cloudFetch<ListResult>(`/v1/dashboard/memory/webhooks/list?limit=${LIST_SAFETY_CEILING}`, {}, { throwOnError: true }),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Webhook | null>(null);
  const [viewingFor, setViewingFor] = useState<Webhook | null>(null);

  const create = useMutation({
    mutationFn: (input: { url: string; label: string; events: string[] }) =>
      cloudFetch<Webhook>('/v1/dashboard/memory/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      setCreateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/memory/webhooks/list'] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => cloudFetch<null>(`/v1/dashboard/memory/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/memory/webhooks/list'] });
    },
  });

  const webhooks = list.data?.webhooks ?? [];

  const columns: DataTableColumn<Webhook>[] = [
    {
      key: 'recent',
      label: '',
      render: (row) => (
        <RecentDeliveriesBadge webhookId={row.id} onClick={() => setViewingFor(row)} />
      ),
    },
    { key: 'label', label: 'Label', render: (row) => <span className="font-medium">{row.label}</span> },
    {
      key: 'url',
      label: 'URL',
      render: (row) => (
        <code className="font-mono text-xs text-muted-foreground">{row.url}</code>
      ),
    },
    {
      key: 'events',
      label: 'Events',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.events.map((e) => (
            <Badge key={e} variant="outline">
              {e}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (row) => (row.created_at ? <Timestamp value={row.created_at} /> : null),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Delete webhook ${row.label}`}
          onClick={() => setPendingDelete(row)}
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageShell
        title="Webhooks"
        description="Register URLs to be notified when memories change."
        primaryAction={{
          label: 'Add webhook',
          icon: Plus,
          onClick: () => setCreateOpen(true),
        }}
      >
       <div className="space-y-6">
        {list.isError ? (
          <Alert intent="warning" title="Could not load webhooks">
            Try again in a moment.
          </Alert>
        ) : list.isLoading ? (
          <Card>Loading…</Card>
        ) : webhooks.length === 0 ? (
          <EmptyState
            title="No webhooks yet"
            description="Click Add webhook to register your first endpoint."
          />
        ) : (
          <Card>
            <DataTable columns={columns} data={webhooks} rowKey={(row) => row.id} />
          </Card>
        )}
       </div>
      </PageShell>

      <AddWebhookDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        submitting={create.isPending}
        onSubmit={(input) => create.mutate(input)}
        description="Register a URL to be notified when memory events occur."
        events={AVAILABLE_EVENTS}
        exemploUrl="https://hook.example.com/memory"
      />

      {pendingDelete ? (
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          title={`Delete webhook "${pendingDelete.label}"?`}
          description={
            <div className="space-y-2 text-sm">
              <p>
                This webhook will be permanently removed. Any future events for
                this URL will not be queued for delivery.
              </p>
              <p className="text-muted-foreground">This cannot be undone.</p>
            </div>
          }
          confirmLabel={revoke.isPending ? 'Deleting…' : 'Delete webhook'}
          cancelLabel="Cancel"
          intent="destructive"
          confirmationPhrase={pendingDelete.label}
          loading={revoke.isPending}
          onConfirm={() => revoke.mutate(pendingDelete.id)}
        />
      ) : null}

      {viewingFor ? (
        <DeliveriesSheet
          webhook={viewingFor}
          open={viewingFor !== null}
          onOpenChange={(o) => !o && setViewingFor(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Memory Webhook Delivery plan T5.7 — per-row Recent deliveries chip.
 * Delivery Replay plan T8.4 — chip becomes a click trigger for the
 * DeliveriesSheet (lifting state to the page).
 */
function RecentDeliveriesBadge({
  webhookId,
  onClick,
}: {
  webhookId: string;
  onClick: () => void;
}) {
  const query = useQuery({
    queryKey: ['cloud', `/v1/dashboard/memory/webhooks/${webhookId}/deliveries`] as const,
    queryFn: () => cloudFetch<DeliveriesResult>(`/v1/dashboard/memory/webhooks/${webhookId}/deliveries`, {}, { throwOnError: true }),
  });
  const deliveries = query.data?.deliveries ?? [];
  if (query.isLoading) {
    return <span className="text-xs text-muted-foreground">…</span>;
  }
  // B-167, nono local — achado pela revisão DEPOIS de o item ter sido marcado shipped.
  if (query.isError) {
    return <span className="text-xs text-muted-foreground" data-testid={`deliveries-error-${webhookId}`}>Could not read</span>;
  }
  if (deliveries.length === 0) {
    return (
      <span className="text-xs text-muted-foreground" data-testid={`deliveries-empty-${webhookId}`}>
        No deliveries
      </span>
    );
  }
  const latest = deliveries[0];
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer"
      aria-label={`View deliveries for webhook ${webhookId}`}
    >
      <Badge variant={deliveryStatusVariant(latest.status)} data-testid={`deliveries-latest-${webhookId}`}>
        {deliveries.length} · {latest.status}
      </Badge>
    </button>
  );
}

/**
 * Delivery Replay plan T8.4 — Sheet listing all recent deliveries with a
 * per-row Replay button gated on status (failed | dead_letter only).
 */
interface DeliveriesSheetProps {
  webhook: Webhook;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function DeliveriesSheet({ webhook, open, onOpenChange }: DeliveriesSheetProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pendingReplay, setPendingReplay] = useState<Delivery | null>(null);

  const query = useQuery({
    queryKey: ['cloud', `/v1/dashboard/memory/webhooks/${webhook.id}/deliveries`] as const,
    queryFn: () => cloudFetch<DeliveriesResult>(`/v1/dashboard/memory/webhooks/${webhook.id}/deliveries`, {}, { throwOnError: true }),
    enabled: open,
  });

  const replay = useMutation({
    mutationFn: (deliveryId: string) =>
      cloudFetch<ReplayResult>(
        `/v1/dashboard/memory/webhooks/${webhook.id}/deliveries/${deliveryId}/replay`,
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      setPendingReplay(null);
      // cloudFetch returns T | null on empty response; on success we expect
      // the JSON body with status + noop. Default to noop=false when null
      // so the toast still surfaces — failure-mode is the destructive toast.
      const noop = data?.noop ?? false;
      toast({
        title: noop ? 'Delivery already queued' : 'Replay queued',
        description: noop
          ? 'This delivery is already pending. No action taken.'
          : 'The delivery has been re-queued and will be dispatched shortly.',
        variant: 'default',
      });
      void queryClient.invalidateQueries({
        queryKey: ['cloud', `/v1/dashboard/memory/webhooks/${webhook.id}/deliveries`],
      });
    },
    onError: () => {
      toast({
        title: 'Could not replay delivery',
        description: 'Please try again. If the problem persists, contact support.',
        variant: 'destructive',
      });
    },
  });

  const deliveries = query.data?.deliveries ?? [];

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <Sheet.Content side="right">
          <Sheet.Header>
            <Sheet.Title>Recent deliveries</Sheet.Title>
            <Sheet.Description>
              {webhook.label} · last {deliveries.length} {deliveries.length === 1 ? 'delivery' : 'deliveries'}
            </Sheet.Description>
          </Sheet.Header>
          <Sheet.Body className="space-y-3">
            {query.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading deliveries…</p>
            ) : query.isError ? (
              <EmptyState title="Could not read this webhook's deliveries" description={FALHA_AO_LER_ENTREGAS} />
            ) : deliveries.length === 0 ? (
              <EmptyState title="No deliveries yet" description="Deliveries appear here once this webhook receives events." />
            ) : (
              deliveries.map((d) => (
                <DeliveryCard
                  key={d.id}
                  delivery={d}
                  onReplayClick={() => setPendingReplay(d)}
                />
              ))
            )}
          </Sheet.Body>
        </Sheet.Content>
      </Sheet>

      {pendingReplay ? (
        <ConfirmDialog
          open={pendingReplay !== null}
          onOpenChange={(o) => !o && setPendingReplay(null)}
          title={`Replay delivery ${pendingReplay.id}?`}
          description={
            <div className="space-y-2 text-sm">
              <p>
                This will re-queue the delivery for dispatch. The subscriber
                URL will receive the same event payload again.
              </p>
              <p>
                <span className="font-medium">Event:</span> {pendingReplay.event_type}
              </p>
              {pendingReplay.last_error_message ? (
                <p className="text-muted-foreground">
                  Last error: <code className="font-mono text-xs">{pendingReplay.last_error_message}</code>
                </p>
              ) : null}
              <p className="text-muted-foreground">
                Retry budget will be reset. Idempotent — safe to retry.
              </p>
            </div>
          }
          confirmLabel={replay.isPending ? 'Replaying…' : 'Replay delivery'}
          cancelLabel="Cancel"
          intent="default"
          confirmationPhrase="replay"
          loading={replay.isPending}
          onConfirm={() => replay.mutate(pendingReplay.id)}
        />
      ) : null}
    </>
  );
}

function DeliveryCard({
  delivery,
  onReplayClick,
}: {
  delivery: Delivery;
  onReplayClick: () => void;
}) {
  return (
    <Card data-testid={`delivery-card-${delivery.id}`}>
      <Card.Body>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant={deliveryStatusVariant(delivery.status)}>{delivery.status}</Badge>
            <code className="font-mono text-xs text-muted-foreground truncate">{delivery.id}</code>
          </div>
          <p className="text-sm font-medium">{delivery.event_type}</p>
          <p className="text-xs text-muted-foreground">
            <Timestamp value={delivery.created_at} /> · attempt {delivery.attempt_count}
          </p>
          {delivery.last_error_message ? (
            <p className="text-xs text-destructive truncate" title={delivery.last_error_message}>
              {delivery.last_error_message}
            </p>
          ) : null}
        </div>
          {canReplay(delivery.status) ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={onReplayClick}
              aria-label={`Replay delivery ${delivery.id}`}
              data-testid={`replay-button-${delivery.id}`}
            >
              <RotateCw className="size-3.5 mr-1" />
              Replay
            </Button>
          ) : null}
        </div>
      </Card.Body>
    </Card>
  );
}

