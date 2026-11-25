import { useQuery } from '@tanstack/react-query';
import { ApiError, engineFetch } from '@/lib/http/api';
import { queryKeys } from '@/lib/api/query-keys';
import type { BuildAttestation, BuildSBOM } from '@/lib/api/types';

/**
 * The two supply-chain artifacts a build produces: its SBOM and its provenance attestation.
 *
 * B-244 — both tabs fetched these themselves, and not merely with transport in the interface
 * layer: they ran a hand-rolled `useEffect` + `useState` + `cancelled` flag, which is a SECOND
 * data-fetching mechanism living beside react-query. It cached nothing, deduplicated nothing,
 * and re-implemented cancellation per tab — so switching tabs and coming back re-fetched, and
 * the two tabs could not share a loading convention because they each invented one.
 *
 * `throwOnError: true` is the third argument of `engineFetch`, not the TanStack option of the
 * same name: it makes a non-2xx reject so the query resolves `isError`, instead of resolving
 * `null` — which a caller reads as "no SBOM" and renders as absence. Both tabs did exactly
 * that before this change (see their tests).
 *
 * `enabled` keeps the query from firing on a route with no build id, which is what the
 * `if (!id) { setLoading(false); return; }` branch used to do by hand.
 *
 * A 404 is the API's answer for a build that has no such artifact (it failed before the SBOM or
 * signing step), so it resolves `null`, which the tabs render as absence. Only 5xx and network
 * failures stay errors, because only those are worth a retry.
 */
async function readArtifact<T>(path: string): Promise<T | null> {
  try {
    return await engineFetch<T>(path, {}, { throwOnError: true });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export function useBuildSBOM(buildId: string) {
  return useQuery({
    queryKey: [...queryKeys.builds.detail(buildId), 'sbom'] as const,
    queryFn: () => readArtifact<BuildSBOM>(`/api/v1/builds/${encodeURIComponent(buildId)}/sbom`),
    enabled: buildId !== '',
  });
}

export function useBuildAttestation(buildId: string) {
  return useQuery({
    queryKey: [...queryKeys.builds.detail(buildId), 'attestation'] as const,
    queryFn: () =>
      readArtifact<BuildAttestation>(`/api/v1/builds/${encodeURIComponent(buildId)}/attestation`),
    enabled: buildId !== '',
  });
}
