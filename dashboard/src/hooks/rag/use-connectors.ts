import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';
import { LIST_SAFETY_CEILING } from '@/lib/http/list-ceiling';

export interface Connection {
  id: string;
  provider_id: string;
  collection_id: string;
  status: string;
  created_at?: string;
}

const BASE = '/v1/dashboard/rag/connectors';

const keys = {
  list: ['cloud', BASE] as const,
  providers: ['cloud', `${BASE}/providers`] as const,
};

export function useConnections() {
  return useQuery({
    queryKey: keys.list,
    queryFn: () =>
      cloudFetch<{ items: Connection[] }>(
        `${BASE}?limit=${LIST_SAFETY_CEILING}`,
        {},
        { throwOnError: true },
      ),
  });
}

export function useOAuthProviders() {
  return useQuery({
    queryKey: keys.providers,
    queryFn: () =>
      cloudFetch<{ providers: string[] }>(
        `${BASE}/providers?limit=${LIST_SAFETY_CEILING}`,
        {},
        { throwOnError: true },
      ),
  });
}


/**
 * Trigger a sync for one connection.
 *
 * B-235 — a refused sync resolved `null` and the list refreshed, so the row went back to showing
 * whatever it showed before. There was never a "sync started" claim to contradict, which is
 * precisely why the refusal was invisible: the screen looked the same whether the request was
 * accepted or rejected.
 */
export function useSyncConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await cloudFetch(
        `${BASE}/${encodeURIComponent(id)}/sync`,
        { method: 'POST' },
        { throwOnError: true },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.list });
    },
  });
}

/**
 * Disconnect a source.
 *
 * B-235 — a refused DELETE closed the confirmation and refreshed the list. The user believes the
 * connector no longer has access to their Drive or their mailbox; it still does.
 */
export function useDisconnectConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await cloudFetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' }, { throwOnError: true });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.list });
    },
  });
}

/**
 * Connect a paste-credential (non-OAuth) source.
 *
 * The BFF proxies the body opaquely to looprag's `POST /v1/connectors/{provider}/connect`; the
 * credential is encrypted at rest and never logged. The body is assembled by the caller for that
 * reason — this module must not learn the shape of anyone's secret.
 *
 * B-235 — without the contract a rejected credential resolved `null`, the sheet closed and the
 * fields were cleared. The user leaves believing the source is connected, and finds out only when
 * no documents ever arrive.
 */
export function useConnectCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { provider: string; body: Record<string, string> }) =>
      cloudFetch<{ id: string }>(
        `${BASE}/${encodeURIComponent(input.provider)}/connect`,
        { method: 'POST', body: JSON.stringify(input.body) },
        { throwOnError: true },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.list });
    },
  });
}
