import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { cloudFetch } from '@/lib/api';

/**
 * use-service-versions (M21) — the dashboard's view of the data-plane versions
 * aggregated by the gateway BFF `GET /v1/dashboard/status/versions`.
 *
 * The union below is STRICT (plan ADR D3/D6): `version` exists ONLY on the `ok`
 * variant, so a degraded service cannot show a stale version — the compiler
 * forbids reaching `s.version` before narrowing by `s.state === 'ok'`. This is
 * deliberately unlike `use-metrics-range.ts:49-55`, which carries `data` next to
 * `status` and stays honest only by discipline.
 */
export type ServiceStatus =
  | { readonly name: string; readonly state: 'ok'; readonly checked_at: string; readonly version: string; readonly built_at?: string }
  | { readonly name: string; readonly state: 'unreachable'; readonly checked_at: string; readonly reason: string }
  | { readonly name: string; readonly state: 'timeout'; readonly checked_at: string; readonly reason?: string }
  | { readonly name: string; readonly state: 'not_deployed'; readonly checked_at: string };

/**
 * The one path the gateway mounts (`internal/routes/service_versions.go`).
 *
 * It is a named export so a test can hold BOTH sides of the contract at once: the
 * Go suite asserts the chi route and this suite mocks the transport wholesale, so
 * until `use-service-versions.test.ts` read the Go source, a typo on either side
 * kept every test green and 404'd on the first load (F-test-1).
 */
export const SERVICE_VERSIONS_PATH = '/v1/dashboard/status/versions';

export interface ServiceVersionsReport {
  readonly collected_at: string;
  readonly services: readonly ServiceStatus[];
}

/** The three levels the footer dot can show. */
export type AggregateState = 'operational' | 'degraded' | 'unknown';

/**
 * Reduce N service states into the footer verdict — by ALLOWLIST, never by
 * exclusion (ADR D9). Green requires proof:
 *
 *  - nothing to read (missing/empty list)          → `unknown`
 *  - every target merely `not_deployed`            → `unknown` (nothing is down,
 *    but nothing is up either — no measured health to claim)
 *  - anything outside `{ok, not_deployed}`         → `degraded`, which also covers
 *    a state this union does not know, because the payload comes from the wire
 *    and not from the compiler
 *  - otherwise                                     → `operational`
 *
 * A lone `not_deployed` does NOT drag the dot to amber (ADR D7: `theo-storage` is
 * permanently absent in dev, and a permanent amber is a new constant lie), but it
 * no longer holds the green up on its own either (ADR D9).
 */
export function aggregateState(services: readonly ServiceStatus[] | undefined): AggregateState {
  if (!services || services.length === 0) return 'unknown';
  if (services.every((s) => s.state === 'not_deployed')) return 'unknown';
  if (!services.every((s) => s.state === 'ok' || s.state === 'not_deployed')) return 'degraded';
  return 'operational';
}

/**
 * The accessible label, derived from counts — never a fixed sentence. This is what
 * keeps a `not_deployed` service visible to assistive technology even though it does
 * not drag the dot down (ADR D7 § Consequences). A `timeout` counts as unreachable so
 * the label never undercounts a failure.
 *
 * The counts are a CENSUS: they always sum to `services.length`. Enumerating only the
 * four known states left a state outside the union in no bucket at all, so the same
 * payload that `aggregateState` turns amber announced an all-clear to assistive
 * technology (F-web-1) — the indicator's lie relocated from the visual channel into
 * the one channel that cannot be double-checked by looking. The residual bucket is
 * derived by subtraction for the same reason `aggregateState` is an allowlist: the
 * payload comes from the wire, not from the compiler (ADR D9).
 */
export function describeStatus(services: readonly ServiceStatus[]): string {
  const operational = services.filter((s) => s.state === 'ok').length;
  const unreachable = services.filter((s) => s.state === 'unreachable' || s.state === 'timeout').length;
  const notDeployed = services.filter((s) => s.state === 'not_deployed').length;
  const unknown = services.length - operational - unreachable - notDeployed;
  const counted = `System status: ${operational} operational, ${unreachable} unreachable, ${notDeployed} not deployed`;
  return unknown > 0 ? `${counted}, ${unknown} unknown` : counted;
}

/**
 * One query for the whole aggregate (ADR D2) — the fan-out lives in the gateway,
 * not in the browser.
 *
 * This hook overrides NO cache policy on purpose: the global client already sets one
 * (`lib/query-client.ts:39-42`), and the staleness window that follows from it is an
 * ACCEPTED, documented risk (plan § R7) rather than something silently tightened here.
 *
 * `throwOnError` IS overridden, and deliberately: under the default contract every
 * 5xx and every network rejection RESOLVES `null`, so the query SUCCEEDS holding
 * nothing — a failed read becomes indistinguishable from a pending one, and the
 * retry guard in `lib/query-client.ts:20-36` never sees a failure to retry. Opting
 * in makes a failure an `isError`, which is the only thing the footer can tell
 * apart from "still loading" (F-web-2). Repo precedent: `pages/memory/graph.tsx:487`
 * and `pages/memory/webhooks.tsx:101` opted in for the same reason.
 */
export function useServiceVersions(): UseQueryResult<ServiceVersionsReport | null> {
  return useQuery({
    queryKey: ['dashboard', 'status', 'versions'],
    queryFn: () => cloudFetch<ServiceVersionsReport>(SERVICE_VERSIONS_PATH, {}, { throwOnError: true }),
  });
}
