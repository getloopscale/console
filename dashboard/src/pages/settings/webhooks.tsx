import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  PageShell,
  Sheet,
  Timestamp,
} from '@usetheo/ui';
import { AppModal } from '@/components/ui/app-modal';
import type { Delivery } from '@/lib/webhooks/delivery';
import { FALHA_AO_LER_ENTREGAS } from '@/pages/settings/webhook-copy';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/http/api';
import { LIST_SAFETY_CEILING } from '@/lib/http/list-ceiling';

/**
 * J-16 Settings › Webhooks — registration-only v0.1.
 *
 * Mirrors pages/memory/webhooks.tsx (create/list/delete) but for the NEW
 * workspace-webhooks resource (deploy events). Backed by the BFF
 * /v1/settings/webhooks endpoints (WorkspaceWebhooksHandler) which persist to
 * the engine workspace_webhooks table (migration 000050).
 *
 * DELIVERY is a later T2-gated slice (the dispatcher/worker is the novel part).
 * Per the same ADR D2 precedent memory_webhooks shipped at, this page discloses
 * the registration-only state with a persistent "Delivery coming soon" Alert so
 * a customer never registers a hook expecting silent events that never fire
 * (Rule 3 — honesty in the UX). The per-webhook HMAC signing secret IS minted
 * now and shown ONCE on create (Stripe show-once pattern) so the customer can
 * store it before delivery goes live.
 */

interface Webhook {
  id: string;
  url: string;
  label: string;
  events: string[];
  created_at?: string;
}

interface CreatedWebhook extends Webhook {
  secret: string;
}

interface ListResult {
  webhooks: Webhook[];
}

// Events this resource actually fires on. Only the events the engine emits are
// offered — subscribing to an event that never fires is dishonest (Rule 3).
// The engine emits deploy.succeeded (release→ACTIVE) + deploy.failed (build
// execution failure); build.* (the build outcome, distinct from the deploy
// outcome) are NOT emitted yet — tracked in theo-cloud#153 (a taxonomy ADR
// decides whether deploy.failed subsumes build.failed).
const AVAILABLE_EVENTS = [
  { id: 'deploy.succeeded', label: 'deploy.succeeded' },
  { id: 'deploy.failed', label: 'deploy.failed' },
] as const;

/**
 * M86 — the SAME webhooks CRUD is mounted in two contexts (Settings and Observability). Only the
 * COPY differs, so the component is parameterized by `context` rather than duplicated (reuse-first).
 * Honesty (Rule 3): the "delivery coming soon" notice is DEPLOY-specific (deploy delivery is not live
 * yet); in observability, alert delivery IS live today (the M84 lens_alert_evaluator dispatches
 * `alert.threshold_breached` to these endpoints), so that notice is omitted and the events offered are
 * the alert event. The backend accepts any non-empty events array (it only rejects empty), so offering
 * the alert event is safe.
 */
export type WebhookContext = 'settings' | 'observability';
interface WebhookContextCopy {
  description: string;
  dialogDescription: string;
  deleteNoun: string;
  events: readonly { id: string; label: string }[];
  deliveryNotice: { title: string; description: string } | null;
}
const WEBHOOK_CONTEXTS: Record<WebhookContext, WebhookContextCopy> = {
  settings: {
    description: 'Register URLs to be notified when deploys and builds change state.',
    dialogDescription: 'Register a URL to be notified when deploy or build events occur.',
    deleteNoun: 'deploy or build',
    events: AVAILABLE_EVENTS,
    deliveryNotice: {
      title: 'Delivery coming soon',
      description:
        'Webhook registration is available now — the endpoints below are saved and each gets a signing secret. Automatic delivery of deploy and build events is rolling out shortly; until then, no events are dispatched.',
    },
  },
  observability: {
    description: 'Register endpoints that receive your observability alert notifications.',
    dialogDescription: 'Register a URL that receives a notification when one of your alert rules fires.',
    deleteNoun: 'alert',
    events: [{ id: 'alert.threshold_breached', label: 'alert.threshold_breached' }],
    deliveryNotice: null, // alert delivery IS live (M84) — no "coming soon" notice in this context
  },
};

const LIST_KEY = ['cloud', '/v1/settings/webhooks/list'] as const;

export function WorkspaceWebhooksPage({ context = 'settings' }: { context?: WebhookContext } = {}) {
  const copy = WEBHOOK_CONTEXTS[context];
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Webhooks'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: LIST_KEY,
    queryFn: () => cloudFetch<ListResult>(`/v1/settings/webhooks/list?limit=${LIST_SAFETY_CEILING}`, {}, { throwOnError: true }),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Webhook | null>(null);
  const [createdSecret, setCreatedSecret] = useState<CreatedWebhook | null>(null);
  const [viewingFor, setViewingFor] = useState<Webhook | null>(null);

  const create = useMutation({
    mutationFn: (input: { url: string; label: string; events: string[] }) =>
      cloudFetch<CreatedWebhook>('/v1/settings/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      setCreateOpen(false);
      if (data?.secret) setCreatedSecret(data);
      void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => cloudFetch<null>(`/v1/settings/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    },
  });

  const webhooks = list.data?.webhooks ?? [];

  const columns: DataTableColumn<Webhook>[] = [
    { key: 'label', label: 'Label', render: (row) => <span className="font-medium">{row.label}</span> },
    {
      key: 'url',
      label: 'URL',
      render: (row) => <code className="font-mono text-xs text-muted-foreground">{row.url}</code>,
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
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`View deliveries for ${row.label}`}
            onClick={() => setViewingFor(row)}
          >
            <History className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Delete webhook ${row.label}`}
            onClick={() => setPendingDelete(row)}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageShell
        title="Webhooks"
        description={copy.description}
        primaryAction={{
          label: 'Add webhook',
          icon: Plus,
          onClick: () => setCreateOpen(true),
        }}
      >
        <div className="space-y-6">
          {copy.deliveryNotice ? (
            <Alert intent="info" title={copy.deliveryNotice.title} description={copy.deliveryNotice.description} />
          ) : null}

          {list.isError ? (
            <Alert
              intent="warning"
              title="Could not load webhooks"
              description="Try again in a moment."
            />
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
        description={copy.dialogDescription}
        events={copy.events}
      />

      {createdSecret ? (
        <SecretShownOnceDialog
          created={createdSecret}
          onClose={() => setCreatedSecret(null)}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          title={`Delete webhook "${pendingDelete.label}"?`}
          description={
            <div className="space-y-2 text-sm">
              <p>
                This webhook will be permanently removed. Any future {copy.deleteNoun}
                {' '}events for this URL will not be queued for delivery.
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

function deliveryStatusVariant(s: Delivery['status']): 'default' | 'success' | 'warning' | 'destructive' {
  switch (s) {
    case 'delivered':
      return 'success';
    case 'pending':
    case 'delivering':
      return 'warning';
    case 'dead_letter':
      return 'destructive';
    default:
      return 'default';
  }
}

/**
 * Read-only delivery history for one webhook (last 10). Backed by
 * GET /v1/settings/webhooks/{id}/deliveries. Populates once the delivery
 * pipeline is live; until then it shows the empty state.
 */
function DeliveriesSheet({
  webhook,
  open,
  onOpenChange,
}: {
  webhook: Webhook;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const query = useQuery({
    queryKey: ['cloud', `/v1/settings/webhooks/${webhook.id}/deliveries`] as const,
    queryFn: () => cloudFetch<{ deliveries: Delivery[] }>(`/v1/settings/webhooks/${webhook.id}/deliveries`, {}, { throwOnError: true }),
    enabled: open,
  });
  const deliveries = query.data?.deliveries ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <Sheet.Content side="right">
        <Sheet.Header>
          <Sheet.Title>Recent deliveries</Sheet.Title>
          <Sheet.Description>
            {webhook.label} · last {deliveries.length} {deliveries.length === 1 ? 'delivery' : 'deliveries'}
          </Sheet.Description>
        </Sheet.Header>
        <Sheet.Body className="space-y-3">
          {/* B-167 — único local fora de `empty=`; `query.isError` existia e não era lido. */}
          {query.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading deliveries…</p>
          ) : query.isError ? (
            <p className="text-sm text-muted-foreground" data-testid="deliveries-error">{FALHA_AO_LER_ENTREGAS}</p>
          ) : deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="deliveries-empty">No deliveries yet.</p>
          ) : (
            deliveries.map((d) => (
              <Card key={d.id} data-testid={`delivery-${d.id}`}>
                <Card.Body>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={deliveryStatusVariant(d.status)}>{d.status}</Badge>
                      <span className="text-sm font-medium">{d.event_type}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <Timestamp value={d.created_at} /> · attempt {d.attempt_count}
                      {d.last_response_status ? ` · HTTP ${d.last_response_status}` : ''}
                    </p>
                    {d.last_error_message ? (
                      <p className="text-xs text-destructive truncate" title={d.last_error_message}>
                        {d.last_error_message}
                      </p>
                    ) : null}
                  </div>
                </Card.Body>
              </Card>
            ))
          )}
        </Sheet.Body>
      </Sheet.Content>
    </Sheet>
  );
}

/**
 * Shows the freshly-minted HMAC signing secret exactly once. The secret is not
 * retrievable after this dialog closes (it is stored hashed on the server side
 * in intent — raw only in the create response), matching the Stripe show-once
 * contract.
 */
function SecretShownOnceDialog({
  created,
  onClose,
}: {
  created: CreatedWebhook;
  onClose: () => void;
}) {
  return (
    <AppModal
      open={true}
      onClose={onClose}
      title={<>Webhook created</>}
      description={<>Copy the signing secret now — it will not be shown again.</>}
      footer={<><Button type="button" onClick={onClose}>
            Done
          </Button></>}
    >
      <div className="space-y-3">
            <div>
              <span className="text-sm font-medium block mb-1">Label</span>
              <p className="text-sm">{created.label}</p>
            </div>
            <div>
              <span className="text-sm font-medium block mb-1">Signing secret</span>
              <code
                className="font-mono text-xs break-all block rounded bg-muted p-2"
                data-testid="webhook-signing-secret"
              >
                {created.secret}
              </code>
            </div>
            <Alert
              intent="warning"
              title="Store this now"
              description="This secret verifies that delivered events came from Theo. It cannot be recovered — if you lose it, delete the webhook and create a new one."
            />
          </div>
    </AppModal>
  );
}

interface AddWebhookDialogProps {
  open: boolean;
  onClose: () => void;
  submitting: boolean;
  onSubmit: (input: { url: string; label: string; events: string[] }) => void;
  description: string;
  events: readonly { id: string; label: string }[];
}

function AddWebhookDialog({ open, onClose, submitting, onSubmit, description, events }: AddWebhookDialogProps) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set([events[0]?.id ?? '']));

  const reset = () => {
    setUrl('');
    setLabel('');
    setSelected(new Set([events[0]?.id ?? '']));
  };
  const handleClose = () => {
    if (!submitting) {
      reset();
      onClose();
    }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    onSubmit({ url, label: label.trim(), events: Array.from(selected) });
  };

  const submitDisabled = submitting || !/^https?:\/\//i.test(url) || label.trim() === '' || selected.size === 0;

  return (
    <AppModal
      open={open}
      onClose={handleClose}
      title={<>Add webhook</>}
      description={<>{description}</>}
      footer={<><Button type="button" variant="ghost" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button><Button type="submit" form="add-workspace-webhook-form" disabled={submitDisabled}>
            {submitting ? 'Adding…' : 'Add webhook'}
          </Button></>}
    >
      <form id="add-workspace-webhook-form" className="space-y-4" onSubmit={submit}>
            <div>
              <label htmlFor="wwh-url" className="text-sm font-medium block mb-1">
                URL
              </label>
              <Input
                id="wwh-url"
                placeholder="https://hook.example.com/deploys"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="wwh-label" className="text-sm font-medium block mb-1">
                Label
              </label>
              <Input
                id="wwh-label"
                placeholder="prod-deploys"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={64}
              />
            </div>
            <fieldset>
              <legend className="text-sm font-medium mb-2">Events</legend>
              <div className="space-y-2">
                {events.map((evt) => (
                  <label key={evt.id} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={selected.has(evt.id)}
                      onCheckedChange={() => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(evt.id)) next.delete(evt.id);
                          else next.add(evt.id);
                          return next;
                        });
                      }}
                      aria-label={evt.id}
                    />
                    <span className="font-mono text-sm">{evt.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </form>
    </AppModal>
  );
}
