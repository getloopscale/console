import type { SignalName } from '@/hooks/projects/signals';
import type { ReadinessStatus } from '@/hooks/projects/status-icons';

/**
 * The eight readiness rules, as DATA (B-225).
 *
 * ## Why they left the hook
 *
 * The `useMemo` in `use-readiness-signals.ts` measured CCN 30, the highest in the repository once
 * the deploy timeline was split out. The algorithm was not hard: it was eight INDEPENDENT
 * derivations stacked in one object literal, each with its own nested ternary. The complexity came
 * from accumulation, not from logic.
 *
 * As a table, each rule is a pure function of `Measurements` and gets its own test without
 * mounting a component or mocking the composed hooks.
 *
 * ## Tristate semantics
 *
 * `unknown` means "could not be measured" and is excluded from both the numerator and the
 * denominator of the score. A composed hook that fails does not paint the row red, because the
 * cause would be our measurement layer, not the reader's project.
 *
 * A field the status response does not carry is `null` here, never `0`. The engine omits fields it
 * has no value for (Go `omitempty`), so reading an absent `replicas_ready` as 0 failed "2+ replicas"
 * for a project serving 2 ready replicas, and reading an absent 5xx rate as 0 passed "logs healthy"
 * with no measurement at all.
 */

/** What the rules decide on: the result already read from the composed hooks. */
export interface Measurements {
  /** The project row did not resolve (cross-tenant probe, 401). */
  readonly projectUnavailable: boolean;
  /** `useProjectStatus` failed or returned no body. */
  readonly statusUnavailable: boolean;
  /** `null` when the status response does not carry `replicas_ready`. */
  readonly readyReplicas: number | null;
  /** `null` when the status response does not carry `alerts_active`. */
  readonly activeAlerts: number | null;
  /** `null` when the status response does not carry `traffic_5xx_pct_1h`. */
  readonly errorRate5xx1h: number | null;
  /** From GET /projects/{name}/connect: 404 is `false`. `null` when the request failed. */
  readonly repositoryConnected: boolean | null;
  /** Secrets GET /secrets lists for the project. `null` when the list could not be read. */
  readonly secretCount: number | null;
  /** The project's domains from GET /domains. `null` when the list could not be read in full. */
  readonly customDomain: CustomDomainState | null;
}

type CustomDomainState = 'verified' | 'unverified' | 'none';

/** Domain statuses that mean the domain answers for the project. */
const VERIFIED_DOMAIN_STATUSES: ReadonlySet<string> = new Set(['verified', 'active']);

/**
 * Reads the project's custom domain from a GET /domains answer. The list covers every project, so
 * rows are filtered by `project`. A list cut short by the page limit cannot prove there is none.
 */
export function readCustomDomain(
  projectName: string,
  response: { domains: ReadonlyArray<{ project: string; status: string }>; total: number } | null | undefined,
): CustomDomainState | null {
  if (!response) return null;
  const own = response.domains.filter((d) => d.project === projectName);
  if (own.some((d) => VERIFIED_DOMAIN_STATUSES.has(d.status))) return 'verified';
  if (own.length > 0) return 'unverified';
  return response.total > response.domains.length ? null : 'none';
}

/** A status field the response did not carry (or carried as something other than a number). */
function measured(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Adapts the output of the composed hooks to `Measurements`.
 *
 * It lives here, named, because it is a responsibility of its own: translating response formats,
 * each with its own way of saying "I don't know", into one vocabulary. It is testable without
 * mounting a component.
 */
export function readMeasurements(input: {
  project: object | undefined;
  statusError: unknown;
  status: {
    replicas_ready?: number;
    alerts_active?: number;
    traffic_5xx_pct_1h?: number;
  } | null | undefined;
  repositoryConnected?: boolean | null;
  secretCount?: number | null;
  customDomain?: CustomDomainState | null;
}): Measurements {
  return {
    projectUnavailable: !input.project,
    statusUnavailable: Boolean(input.statusError) || !input.status,
    readyReplicas: measured(input.status?.replicas_ready),
    activeAlerts: measured(input.status?.alerts_active),
    errorRate5xx1h: measured(input.status?.traffic_5xx_pct_1h),
    repositoryConnected: input.repositoryConnected ?? null,
    secretCount: input.secretCount ?? null,
    customDomain: input.customDomain ?? null,
  };
}

type Rule = (m: Measurements) => ReadinessStatus;

export const RULES: Readonly<Record<SignalName, Rule>> = {
  // Auto-deploy needs a connected repository. `last_deploy` is not evidence: a CLI deploy sets it
  // with no repository (#549).
  auto_deploy: (m) => {
    if (m.projectUnavailable || m.repositoryConnected === null) return 'unknown';
    return m.repositoryConnected ? 'pass' : 'fail';
  },

  // The status response has no field that says whether an HPA exists. The desired replica count
  // is not one: two fixed replicas are not autoscaling, and an HPA can sit at one replica. Until
  // the API reports the HPA itself, the signal is `unknown`.
  hpa_configured: () => 'unknown',

  // Two or more replicas ACTUALLY serving; desiring them is not enough.
  two_plus_replicas: (m) => {
    if (m.statusUnavailable || m.readyReplicas === null) return 'unknown';
    return m.readyReplicas >= 2 ? 'pass' : 'fail';
  },

  // At least one secret listed by GET /secrets across the project's environments.
  secrets_rotated: (m) => {
    if (m.secretCount === null) return 'unknown';
    return m.secretCount > 0 ? 'pass' : 'fail';
  },

  // A domain of this project that verified. A pending one does not serve customers yet.
  custom_domain: (m) => {
    if (m.customDomain === null) return 'unknown';
    return m.customDomain === 'verified' ? 'pass' : 'fail';
  },

  // `alerts_active > 0` proves alerts are configured: they fired. Zero is ambiguous (no alert
  // configured OR everything healthy), so it stays `unknown`.
  alerts_configured: (m) => {
    if (m.statusUnavailable || m.activeAlerts === null) return 'unknown';
    return m.activeAlerts > 0 ? 'warn' : 'unknown';
  },

  // 5xx bands over 1h, aligned with the LoopScale SLO.
  logs_healthy: (m) => {
    if (m.statusUnavailable || m.errorRate5xx1h === null) return 'unknown';
    if (m.errorRate5xx1h < 0.01) return 'pass';
    if (m.errorRate5xx1h < 0.05) return 'warn';
    return 'fail';
  },

  // The API reports no cache hit rate. Having a build says nothing about the cache, so the signal
  // is `unknown` until a hit rate is in the response.
  cache_hit_rate: () => 'unknown',
};
