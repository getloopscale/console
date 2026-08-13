import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { DELIVERIES_READ_FAILURE } from '@/pages/settings/webhook-copy';
import type { Delivery } from '@/lib/webhooks/delivery';
import { deliveryStatusVariant, canReplay } from '@/lib/webhooks/delivery';
import { colunasDeWebhook } from '@/lib/webhooks/columns';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import {
  useMemoryWebhooks,
  useCreateMemoryWebhook,
  useRevokeMemoryWebhook,
  useMemoryWebhookDeliveries,
  useReplayMemoryDelivery,
  type MemoryWebhook as Webhook,
} from '@/hooks/memory/use-memory-webhooks';

/**
 * Plan 3 of dashboard-memory-section-roadmap.md, T3.7.
 * Delivery Replay plan, T8.4 — adds per-delivery Replay button to a Sheet
 * listing all 10 recent deliveries per webhook.
 *
 * /memory/webhooks — webhook registration + delivery inspection UI.
 */


const AVAILABLE_EVENTS = [
  { id: 'memory.remembered', label: 'memory.remembered' },
  { id: 'memory.forgotten', label: 'memory.forgotten' },
  { id: 'memory.exported', label: 'memory.exported' },
] as const;

export function WebhooksPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Webhooks'), [setPageTitle]);
  useRequireAuth();

  const list = useMemoryWebhooks();

  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Webhook | null>(null);
  const [viewingFor, setViewingFor] = useState<Webhook | null>(null);

  const create = useCreateMemoryWebhook();

  const revoke = useRevokeMemoryWebhook();

  const webhooks = list.data?.webhooks ?? [];

  // B-183 — as quatro colunas que descrevem o webhook vêm de `lib/webhooks/columns.tsx`; o selo de
  // entregas recentes e a exclusão são desta tela.
  const columns: DataTableColumn<Webhook>[] = [
    {
      key: 'recent',
      label: '',
      render: (row) => (
        <RecentDeliveriesBadge webhookId={row.id} onClick={() => setViewingFor(row)} />
      ),
    },
    ...colunasDeWebhook<Webhook>(),
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
        exampleUrl="https://hook.example.com/memory"
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
  const query = useMemoryWebhookDeliveries(webhookId);
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

  const query = useMemoryWebhookDeliveries(webhook.id, open);

  const replay = useReplayMemoryDelivery(webhook.id);

  // Os efeitos de UI ficam AQUI, e só rodam no desfecho que de fato aconteceu. Antes viviam no
  // `onSuccess` da mutação — que, sem o contrato de erro, disparava também numa recusa: o diálogo
  // fechava e o toast dizia "Replay queued" para um replay que nunca foi enfileirado (B-235).
  const onReplayed = (data: { noop: boolean }) => {
    setPendingReplay(null);
    toast({
      title: data.noop ? 'Delivery already queued' : 'Replay queued',
      description: data.noop
        ? 'This delivery is already pending. No action taken.'
        : 'The delivery has been re-queued and will be dispatched shortly.',
      variant: 'default',
    });
    void queryClient.invalidateQueries({
      queryKey: ['cloud', `/v1/dashboard/memory/webhooks/${webhook.id}/deliveries`],
    });
  };

  const onReplayFailed = () => {
    toast({
      title: 'Could not replay delivery',
      description: 'Please try again. If the problem persists, contact support.',
      variant: 'destructive',
    });
  };

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
              <EmptyState title="Could not read this webhook's deliveries" description={DELIVERIES_READ_FAILURE} />
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
          onConfirm={() => {
            replay.mutate(pendingReplay.id, { onSuccess: onReplayed, onError: onReplayFailed });
          }}
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

