import { useQuery } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/api';

/**
 * use-provisioning-status (M0 J-02 T2.1).
 *
 * Polls the BFF `GET /v1/auth/me` while a freshly-registered tenant's
 * after-registration bootstrap is still running, and STOPS once it reports
 * `active` (or a terminal `unknown`). The register "completing" screen (T3.1)
 * uses this to know when to redirect to /projects. Consumes the `provisioning`
 * snapshot the backend added to /me (T1.2).
 */

/** Poll cadence while provisioning is still pending. */
export const __test_POLL_INTERVAL_MS = 2000;

/** The provisioning-relevant slice of the /v1/auth/me response. */
export interface MeProvisioning {
  provisioning?: 'active' | 'pending' | 'unknown';
  plan?: string;
  subscription_status?: string;
}

/**
 * Pure polling decision: keep polling while the snapshot is not yet loaded or
 * still `pending`; stop on any resolved terminal state (`active`, `unknown`, or
 * a response with no `provisioning` field — an old backend / DB-less mode).
 * Extracted so the cadence logic is unit-testable without timers.
 */
export function provisioningRefetchInterval(data: MeProvisioning | null | undefined): number | false {
  if (data == null) return __test_POLL_INTERVAL_MS;
  return data.provisioning === 'pending' ? __test_POLL_INTERVAL_MS : false;
}

export function useProvisioningStatus(enabled = true): {
  status: MeProvisioning['provisioning'];
  plan?: string;
  subscriptionStatus?: string;
  loading: boolean;
} {
  const query = useQuery({
    queryKey: ['provisioning-status'],
    queryFn: () => cloudFetch<MeProvisioning>('/v1/auth/me'),
    enabled,
    refetchInterval: (q) => provisioningRefetchInterval(q.state.data),
  });
  return {
    status: query.data?.provisioning,
    plan: query.data?.plan,
    subscriptionStatus: query.data?.subscription_status,
    loading: query.isLoading,
  };
}
