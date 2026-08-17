import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';
import type { Delivery } from '@/lib/webhooks/delivery';
import { LIST_SAFETY_CEILING } from '@/lib/http/list-ceiling';

export interface MemoryWebhook {
  id: string;
  url: string;
  label: string;
  events: string[];
  created_at?: string;
}

export interface MemoryWebhookListResult {
  webhooks: MemoryWebhook[];
}

export interface ReplayResult {
  id: string;
  status: 'pending' | 'delivering';
  noop: boolean;
}

export interface MemoryWebhookInput {
  url: string;
  label: string;
  events: string[];
}

const BASE = '/v1/dashboard/memory/webhooks';

const keys = {
  list: ['cloud', `${BASE}/list`] as const,
  deliveries: (id: string) => ['cloud', `${BASE}/${id}/deliveries`] as const,
};

/**
 * The memory-webhooks resource: list, create, revoke, delivery history, replay.
 *
 * B-244 — the sibling of `use-workspace-webhooks.ts`, and it carried the same three defects for the
 * same reason: two screens grew the same feature separately, so a fix to one never reached the
 * other. An architecture review flagged this file while the settings one was being fixed, and it is
 * being closed here rather than left as "same thing, other endpoint".
 *
 * The endpoints genuinely differ (`/v1/dashboard/memory/webhooks` vs `/v1/settings/webhooks`), so
 * this is a sibling module and not a shared one. Merging them would mean inventing a parameter for
 * "which webhooks resource", which is the abstraction nobody asked for.
 */
export function useMemoryWebhooks() {
  return useQuery({
    queryKey: keys.list,
    queryFn: () =>
      cloudFetch<MemoryWebhookListResult>(
        `${BASE}/list?limit=${LIST_SAFETY_CEILING}`,
        {},
        { throwOnError: true },
      ),
  });
}

/**
 * Register a webhook.
 *
 * B-235 — no error contract, so a refused registration RESOLVED `null`, the dialog closed and the
 * list refreshed. The user left believing memory events would reach a URL the server never
 * accepted.
 */
export function useCreateMemoryWebhook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: MemoryWebhookInput) =>
      cloudFetch<MemoryWebhook>(
        BASE,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        { throwOnError: true },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.list });
    },
  });
}

/**
 * Revoke a webhook.
 *
 * B-235 — the reading here is the one that costs: an endpoint the user believes they cut off keeps
 * receiving their memory events, and the screen said it was gone.
 */
export function useRevokeMemoryWebhook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await cloudFetch(
        `${BASE}/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        { throwOnError: true },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.list });
    },
  });
}

/**
 * Delivery history for one webhook.
 *
 * `enabled` exists because two callers genuinely differ: the row badge reads eagerly, the sheet
 * only while it is open. Both used to build this query themselves, which is fine until they
 * disagree about the key — and they shared one, by coincidence rather than by construction.
 */
export function useMemoryWebhookDeliveries(webhookId: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: keys.deliveries(webhookId),
    queryFn: () =>
      cloudFetch<{ deliveries: Delivery[] }>(
        `${BASE}/${encodeURIComponent(webhookId)}/deliveries`,
        {},
        { throwOnError: true },
      ),
  });
}

/**
 * Replay one delivery.
 *
 * B-235 — this is the subtlest of the three, because the page had ALREADY reasoned about the
 * `null`: its comment said "default to noop=false when null so the toast still surfaces". That
 * reasoning is right about the shape and wrong about the cause — the `null` it was defending
 * against is not an empty body, it is a REFUSAL. So a rejected replay closed the dialog and
 * announced "Replay queued" for something that was never queued.
 *
 * With the contract, a refusal rejects and the only `null` left is a 2xx with no body — which for
 * a POST whose entire purpose is to report `status` and `noop` is a contract violation, so it
 * throws rather than defaulting `noop` and announcing a guess.
 */
export function useReplayMemoryDelivery(webhookId: string) {
  return useMutation({
    mutationFn: async (deliveryId: string): Promise<ReplayResult> => {
      const replayed = await cloudFetch<ReplayResult>(
        `${BASE}/${encodeURIComponent(webhookId)}/deliveries/${encodeURIComponent(deliveryId)}/replay`,
        { method: 'POST' },
        { throwOnError: true },
      );
      if (replayed === null) {
        throw new Error('The replay was accepted but the server did not say what it did.');
      }
      return replayed;
    },
  });
}
