import { useMutation } from '@tanstack/react-query';
import { engineFetch } from '@/lib/http/api';

/**
 * Delete a tenant — the account/workspace and everything under it.
 *
 * B-264 — this was hand-rolled twice, in `settings/profile.tsx` and `settings/overview.tsx`,
 * with the same `try/finally` and the same missing error branch. Neither passed
 * `{ throwOnError: true }`, so a non-2xx RESOLVED `null` (B-235) and nothing inspected it: the
 * dialog closed and the user was signed out or navigated away over a request that failed.
 *
 * The user's reading of that is unambiguous and wrong — the confirmation closed and they were
 * signed out, so the account is gone. It may not be. For the most destructive action in the
 * product, reporting success it did not observe is the worst available failure mode.
 *
 * `throwOnError: true` makes a refusal arrive as an `ApiError` the caller can name. The one
 * `null` it leaves is a 2xx with no body, which for a DELETE is a legitimate 204 — so `null` is
 * SUCCESS here, and this is the endpoint where that distinction matters most. It is spelled out
 * rather than inferred, because `null` meaning two opposite things across two endpoints is
 * exactly what B-235 is about.
 */
export function useDeleteTenant() {
  return useMutation({
    mutationFn: async (tenantId: string): Promise<void> => {
      await engineFetch(
        `/api/v1/tenants/${encodeURIComponent(tenantId)}`,
        { method: 'DELETE' },
        { throwOnError: true },
      );
    },
  });
}
