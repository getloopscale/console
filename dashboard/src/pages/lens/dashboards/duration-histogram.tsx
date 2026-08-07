import { useQuery } from '@tanstack/react-query';
import { Card, Histogram, Skeleton } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import { cloudFetch } from '@/lib/api';
import { formatDuration } from '@/lib/formatting/format';
import type { Trace } from '../traces/columns';

/**
 * M11 — the trace-duration DISTRIBUTION histogram for the dashboards board. Reuses the existing
 * traces read (`GET /v1/dashboard/lens/traces` via `cloudFetch`) and bins each trace's `durationMs`
 * client-side into the design system's `Histogram` (which owns its own binning + empty state). A
 * trace with no finite `durationMs` is DROPPED — never binned as 0 (M59 R2 data-honesty).
 */

interface TracesResult {
  traces: Trace[];
}

/** The finite `durationMs` values from the traces list (drops absent / NaN / ±Infinity — no fabricated 0). */
export function durationsFromTraces(traces: Trace[]): number[] {
  const out: number[] = [];
  for (const t of traces) {
    if (typeof t.durationMs === 'number' && Number.isFinite(t.durationMs)) out.push(t.durationMs);
  }
  return out;
}

/** How many equal-width bins the duration histogram uses (Histogram degrades gracefully below this). */
const DURATION_BIN_COUNT = 12;

export function DurationHistogram() {
  // The current-view traces (the board's default window). Reuses the shared traces read — no new endpoint.
  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/traces', 'dashboards-duration'] as const,
    queryFn: () => cloudFetch<TracesResult>('/v1/dashboard/lens/traces', {}, { throwOnError: true }),
  });

  if (query.isPending) {
    return <Skeleton className="h-44 w-full" aria-label="Loading trace durations" />;
  }
  if (query.isError) {
    return (
      <Alert
        intent="warning"
        title="Could not load trace durations"
        description="The traces list is unavailable — the duration histogram has no data to show."
        data-testid="duration-histogram-error"
      />
    );
  }

  const durations = durationsFromTraces(query.data?.traces ?? []);
  return (
    <Card>
      <Card.Body>
        <Histogram
          title="Trace duration"
          values={durations}
          binCount={DURATION_BIN_COUNT}
          valueFormatter={(ms) => formatDuration(ms)}
        />
      </Card.Body>
    </Card>
  );
}
