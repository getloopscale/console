import { Card } from '@usetheo/ui';
import type { BuildStatsDay } from '@/hooks/overview/use-build-stats';

/**
 * DeploysActivity (T-P1) — a compact 7-day deploys bar chart for the Overview.
 *
 * Pure presentational component: it receives the REAL `byDay` series from
 * `useBuildStats('7d')` (GET /api/v1/builds/stats, dense + zero-filled server-side).
 * It never fabricates data — an errored fetch renders an honest error line, not zeros.
 * This is the "what happened recently" view that pairs with the "Deploys (7d)" KPI:
 * the KPI gives the count, these bars give the distribution.
 */
export function DeploysActivity({
  byDay,
  loading,
  error,
}: {
  readonly byDay: readonly BuildStatsDay[];
  readonly loading: boolean;
  readonly error: boolean;
}) {
  if (loading) {
    return (
      <Card className="p-4">
        <div data-testid="deploys-activity-skeleton" className="flex h-24 items-end gap-1.5" aria-hidden="true">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex-1 animate-pulse rounded-sm bg-muted" style={{ height: `${30 + ((i * 17) % 60)}%` }} />
          ))}
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">Couldn&rsquo;t load deploy activity. Try again shortly.</p>
      </Card>
    );
  }

  const total = byDay.reduce((sum, d) => sum + d.count, 0);
  const max = byDay.reduce((m, d) => Math.max(m, d.count), 0);

  if (total === 0) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">No deploys in the last 7 days.</p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">Last 7 days</span>
        <span className="font-mono text-body-lg font-semibold tabular-nums text-foreground">{total}</span>
      </div>
      <div className="flex h-24 items-end gap-1.5" role="group" aria-label="Deploys per day, last 7 days">
        {byDay.map((d) => {
          const pct = max === 0 ? 0 : Math.round((d.count / max) * 100);
          return (
            <div
              key={d.date}
              className="flex-1 rounded-sm bg-primary/80"
              style={{ height: `${Math.max(pct, d.count > 0 ? 8 : 3)}%` }}
              role="img"
              aria-label={`${d.count} ${d.count === 1 ? 'deploy' : 'deploys'} on ${d.date}`}
              title={`${d.count} on ${d.date}`}
            />
          );
        })}
      </div>
    </Card>
  );
}
