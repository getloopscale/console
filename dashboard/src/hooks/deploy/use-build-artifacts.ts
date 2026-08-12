import { useQuery } from '@tanstack/react-query';
import { engineFetch } from '@/lib/http/api';
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
 */
export function useBuildSBOM(buildId: string) {
  return useQuery({
    queryKey: [...queryKeys.builds.detail(buildId), 'sbom'] as const,
    queryFn: () =>
      engineFetch<BuildSBOM>(
        `/api/v1/builds/${encodeURIComponent(buildId)}/sbom`,
        {},
        { throwOnError: true },
      ),
    enabled: buildId !== '',
  });
}

export function useBuildAttestation(buildId: string) {
  return useQuery({
    queryKey: [...queryKeys.builds.detail(buildId), 'attestation'] as const,
    queryFn: () =>
      engineFetch<BuildAttestation>(
        `/api/v1/builds/${encodeURIComponent(buildId)}/attestation`,
        {},
        { throwOnError: true },
      ),
    enabled: buildId !== '',
  });
}
