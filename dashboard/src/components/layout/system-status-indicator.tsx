import { Link } from 'react-router-dom';

import {
  aggregateState,
  describeStatus,
  useServiceVersions,
  type AggregateState,
} from '@/hooks/overview/use-service-versions';

/**
 * The sidebar footer's health indicator (M21).
 *
 * It replaces a literal `● Operational` under a fixed aria-label that declared
 * every system healthy — a claim with no data behind it, which stayed green
 * through nine commits of a service that never built. The old sentence survives
 * only inside the negative assertions that now guard against its return.
 * Dot, text and label are now all derived from the same aggregate, per
 * render, so the footer and the /status page cannot disagree (ADR D3).
 *
 * Two properties are load-bearing:
 *
 *  - It NEVER suspends and never returns null. The sidebar wraps every
 *    authenticated page, so a slow probe must not hold the navigation (risk R1);
 *    while the query is pending the neutral level shows and the sidebar is painted.
 *  - `role="status"` lives on a <span> INSIDE the <Link>, never on the Link
 *    itself (EC-4): an explicit role overrides the implicit `link` role, and the
 *    indicator would stop being announced as something one can open — while an
 *    `href` assertion would still pass, because the attribute stays in the DOM.
 */
/**
 * The levels the footer can show. `unavailable` is NOT an aggregate — no aggregate
 * exists when the read failed — so it is a rendering level, kept out of
 * `AggregateState` on purpose: the derivation stays a function of the services.
 */
type IndicatorLevel = AggregateState | 'unavailable';

const TEXT: Record<IndicatorLevel, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  unknown: 'Checking…',
  unavailable: 'Status unavailable',
};

export function SystemStatusIndicator() {
  const { data, isPending, isError } = useServiceVersions();
  const services = data?.services;
  /**
   * A settled query holding nothing is a FAILED read, never a pending one. Both
   * arms are load-bearing: `isError` is the real path now that the hook opts into
   * the throwing contract, and `data == null` still catches a 2xx with no body —
   * and is what a suite mocking `@/lib/api` wholesale can reach.
   *
   * Collapsing this into `unknown` published "Checking…", a word that asserts a
   * probe still running, over a pipeline that will never land again — with an
   * accessible name of three measured-looking zeros produced by a request that
   * never returned (error-handling.md § 2: the pending state was being used as
   * the magic value for "read failed").
   */
  const unreadable = !isPending && (isError || data == null);
  const level: IndicatorLevel = isPending ? 'unknown' : unreadable ? 'unavailable' : aggregateState(services);
  const label = isPending
    ? 'System status: checking'
    : unreadable
      ? 'System status: unavailable'
      : describeStatus(services ?? []);

  return (
    <Link
      to="/status"
      data-testid="system-status-indicator"
      className="flex items-center gap-2 text-label text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
    >
      <span role="status" aria-label={label} className="flex items-center gap-2">
        <StatusDot level={level} />
        <span>{TEXT[level]}</span>
      </span>
    </Link>
  );
}

/**
 * The dot. Only the healthy level keeps the ping animation — on a neutral or
 * degraded state that animation reinforced exactly the false liveliness this
 * component exists to remove.
 *
 * `unavailable` shares the neutral tone with `unknown` rather than going amber:
 * amber is the verdict "a service is degraded", which is a measurement, and a read
 * that failed measured nothing. The words carry the difference; the colour would
 * only claim knowledge we do not have.
 */
function StatusDot({ level }: { level: IndicatorLevel }) {
  if (level === 'operational') {
    return (
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-success" />
      </span>
    );
  }
  const tone = level === 'degraded' ? 'bg-warning' : 'bg-muted-foreground';
  return <span className={`inline-flex size-2 shrink-0 rounded-full ${tone}`} />;
}
