import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';
import type { Delivery } from '@/lib/webhooks/delivery';
import { LIST_SAFETY_CEILING } from '@/lib/http/list-ceiling';

/** A registered workspace webhook, as `/v1/settings/webhooks/list` returns it. */
export interface Webhook {
  id: string;
  url: string;
  label: string;
  events: string[];
  created_at?: string;
}

/** The creation response, which carries the signing secret — shown once and never again. */
export interface CreatedWebhook extends Webhook {
  secret: string;
}

export interface WebhookListResult {
  webhooks: Webhook[];
}

export interface WebhookInput {
  url: string;
  label: string;
  events: string[];
}

/**
 * The workspace-webhooks resource: list, create, revoke.
 *
 * B-244 — `settings/webhooks.tsx` built all three requests itself, choosing the URL, the row
 * limit, the cache key and the error policy inside the screen.
 *
 * Two of the three carried a defect of the B-264 kind, and on the two operations where it costs
 * most:
 *
 *   - `create` had no `{ throwOnError: true }`, so a refused registration RESOLVED `null`. The
 *     handler then closed the dialog and invalidated the list — reporting a webhook that was
 *     never registered. The user's reading is that events will now arrive; they will not.
 *   - `revoke` had the same gap on a DELETE. A refused revocation closed the dialog and refreshed
 *     the list, so an endpoint the user believes they just cut off keeps receiving their events —
 *     which for a webhook means credentials and payloads continuing to reach a URL they revoked.
 *
 * With `throwOnError: true` a refusal arrives as an `ApiError` the caller can name, and
 * `ConfirmDialog` already keeps itself open and states the reason (B-105).
 *
 * `create` narrows `CreatedWebhook | null` and refuses a 2xx with no body: the response's whole
 * purpose is to carry the signing secret exactly once, so a body-less success is a contract
 * violation, not a webhook without a secret.
 */
export const workspaceWebhookKeys = {
  all: ['cloud', '/v1/settings/webhooks/list'] as const,
  deliveries: (id: string) => ['cloud', `/v1/settings/webhooks/${id}/deliveries`] as const,
};

export function useWorkspaceWebhooks() {
  return useQuery({
    queryKey: workspaceWebhookKeys.all,
    queryFn: () =>
      cloudFetch<WebhookListResult>(
        `/v1/settings/webhooks/list?limit=${LIST_SAFETY_CEILING}`,
        {},
        { throwOnError: true },
      ),
  });
}

export function useCreateWorkspaceWebhook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: WebhookInput): Promise<CreatedWebhook> => {
      const created = await cloudFetch<CreatedWebhook>(
        '/v1/settings/webhooks',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        { throwOnError: true },
      );
      if (created === null) {
        throw new Error(
          'The webhook was accepted but no signing secret came back — it cannot be shown later.',
        );
      }
      return created;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceWebhookKeys.all });
    },
  });
}

export function useRevokeWorkspaceWebhook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      // `null` here is a 204 on a DELETE, which is the success. The refusals that used to arrive
      // as the same `null` now reject (see the docblock above).
      await cloudFetch(`/v1/settings/webhooks/${id}`, { method: 'DELETE' }, { throwOnError: true });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceWebhookKeys.all });
    },
  });
}

/**
 * Delivery history for one webhook (last 10).
 *
 * `enabled` keeps the request from firing while the sheet is closed — the page used to pass the
 * same flag by hand, which is fine until two callers disagree about it.
 */
export function useWorkspaceWebhookDeliveries(id: string, enabled: boolean) {
  return useQuery({
    queryKey: workspaceWebhookKeys.deliveries(id),
    queryFn: () =>
      cloudFetch<{ deliveries: Delivery[] }>(
        `/v1/settings/webhooks/${id}/deliveries`,
        {},
        { throwOnError: true },
      ),
    enabled,
  });
}
