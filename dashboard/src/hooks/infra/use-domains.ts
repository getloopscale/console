import { useQuery } from '@tanstack/react-query';
import { engineFetch } from '@/lib/http/api';
import { queryKeys } from '@/lib/api/query-keys';
import { LIST_SAFETY_CEILING } from '@/lib/http/list-ceiling';
import { domainsRefetchInterval } from './domains-refetch-interval';
/**
 * The row shape GET /api/v1/domains actually returns.
 *
 * NOT `@/lib/api/types`'s `Domain`: the page carried its own, richer copy, and `tsc` proved
 * the difference the moment the hook tried to use the shared one — `nameservers` and
 * `failure_mode` exist on the wire and are missing from the shared type. Switching the page to
 * the narrower shape would have silently deleted two fields the UI renders.
 *
 * Declared here rather than in the page: the shape of a response is knowledge about the
 * ENDPOINT, and the endpoint is this hook's subject. A page that owns it is a page that has to be
 * edited when the backend changes.
 *
 * This is NOT the layer ADR-0006 decided, and saying so matters — an earlier draft of this
 * docblock cited the ADR as though it were. ADR-0006 is still `proposed` and chose `features/<f>/
 * api/`, a `lib/api/keys.ts` exposing `cloudKey`/`engineKey`, and an ESLint rule banning
 * array-literal query keys. None of the three exist (B-266). What moved here is transport and
 * response shape, one endpoint at a time.
 *
 * Reconciling this with `@/lib/api/types` is real work and belongs to whoever owns that type —
 * filed rather than done here, because widening a shared type from one caller's evidence is how
 * a type stops describing anything.
 */
export interface DomainRow {
  id: string;
  domain: string;
  project: string;
  app: string;
  environment: string;
  status: string;
  tls?: { status: string; expires_at?: string };
  verification?: { txt_name: string; txt_value: string };
  cname_target: string;
  created_at: string;
  verified_at?: string;
  nameservers?: string[];
  failure_mode?: string;
}

export interface DomainsResponse {
  domains: DomainRow[];
  total: number;
}

/**
 * The domains listing.
 *
 * B-244 — `infra/domains.tsx` built this request itself: it chose the URL, the limit, the
 * `throwOnError` policy and the query key, all inside the screen. That is data access in the
 * interface layer, and it is how the same endpoint came to be read differently by different
 * screens (`query-key-convergence.test.ts` exists because of it).
 *
 * `throwOnError: true` is the THIRD argument of `engineFetch`, not the TanStack option of the
 * same name. It makes a non-2xx reject the promise so the query resolves `isError`, instead of
 * `cloudFetch`'s default of resolving `null` — which a caller reads as "empty list" and renders
 * as "no domains yet". The caller still has to READ `isError`; this only guarantees there is
 * something to read.
 */
export function useDomains() {
  return useQuery({
    queryKey: queryKeys.domains.list(),
    queryFn: () =>
      engineFetch<DomainsResponse>(
        `/api/v1/domains?limit=${LIST_SAFETY_CEILING}`,
        {},
        { throwOnError: true },
      ),
    refetchInterval: (q) => domainsRefetchInterval(q.state.data),
  });
}
