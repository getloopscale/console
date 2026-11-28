import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';
import { queryKeys } from '@/lib/api/query-keys';
import { LIST_SAFETY_CEILING } from '@/lib/http/list-ceiling';

/** A row of `GET /v1/sandboxes`, as the sandbox service documents it. */
export interface SandboxRow {
  id: string;
  image?: string;
  state: string;
  created_at: string;
  expires_at?: string;
  /** Present only when the sandbox has outbound rules. */
  network?: { allow_out?: string[]; deny_out?: string[] };
}

/** A sandbox starts and ends without this screen, so the list is read again on this interval. */
const SANDBOXES_REFETCH_MS = 10_000;

/**
 * The organization's sandboxes that have not been destroyed.
 *
 * `/v1/sandboxes` is served by this console, which forwards it to the sandbox service, so the
 * request carries the session like any other console call. `throwOnError` makes a failed read an
 * error instead of `null`, which the screen would show as "no sandboxes".
 */
export function useSandboxes() {
  return useQuery({
    queryKey: queryKeys.sandboxes.list(),
    queryFn: () =>
      cloudFetch<{ sandboxes: SandboxRow[] }>(
        `/v1/sandboxes?limit=${LIST_SAFETY_CEILING}`,
        {},
        { throwOnError: true },
      ),
    refetchInterval: SANDBOXES_REFETCH_MS,
  });
}

/** Destroy one sandbox, then read the list again. */
export function useTerminateSandbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      cloudFetch(
        `/v1/sandboxes/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        { throwOnError: true },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sandboxes.all });
    },
  });
}
