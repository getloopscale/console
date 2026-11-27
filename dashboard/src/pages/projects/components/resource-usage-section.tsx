import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Cpu, MemoryStick, RotateCw } from 'lucide-react';
import { Button, Card, Skeleton } from '@getloopscale/ui';
import { useMetricsRange, type UseMetricsRangeResult } from '@/hooks/projects/use-metrics-range';
import { ResourceChart } from './resource-chart';
import { niceBytes, niceDecimal } from './resource-chart-geometry';
import {
  USAGE_BAND_LABEL,
  formatBytes,
  formatCpu,
  formatRestarts,
  formatShare,
  usageBand,
  usageShare,
  type UsageBand,
} from './resource-format';

/**
 * ResourceUsageSection charts what the app of an environment consumes: CPU and memory against
 * their limits, and container restarts. Every number comes from the metrics endpoint; a series
 * the platform has not collected yet says so and draws nothing.
 */
export interface ResourceUsageSectionProps {
  projectName: string;
  env: string;
}

const RANGES = [
  { value: '1h', label: '1h', name: 'Last hour' },
  { value: '24h', label: '24h', name: 'Last 24 hours' },
  { value: '7d', label: '7d', name: 'Last 7 days' },
] as const;
type RangeValue = (typeof RANGES)[number]['value'];

const BAND_FILL: Record<UsageBand, string> = {
  ok: 'bg-primary',
  high: 'bg-warning',
  critical: 'bg-destructive',
  unknown: 'bg-muted-foreground',
};
const BAND_TEXT: Record<UsageBand, string> = {
  ok: 'text-muted-foreground',
  high: 'text-warning',
  critical: 'text-destructive',
  unknown: 'text-muted-foreground',
};

const latest = (series: UseMetricsRangeResult): number | null => {
  const point = series.data[series.data.length - 1];
  return point && Number.isFinite(point.v) ? point.v : null;
};

/** What a card shows where the chart would be when there is no series to draw. */
function emptyReason(series: UseMetricsRangeResult): string | null {
  if (series.loading) return null;
  if (series.status === 'prometheus_unreachable') return 'Metrics are unavailable right now.';
  if (series.data.length === 0) return series.collectingHint ?? 'Collecting data. The first points arrive a few minutes after a deploy.';
  return null;
}

interface ResourceCardProps {
  icon: typeof Cpu;
  title: string;
  value: string | null;
  detail: string;
  series: UseMetricsRangeResult;
  children: React.ReactNode;
  badge?: React.ReactNode;
  meter?: React.ReactNode;
}

function ResourceCard({ icon: Icon, title, value, detail, series, children, badge, meter }: ResourceCardProps) {
  const reason = emptyReason(series);
  return (
    <Card className="flex flex-col gap-4 p-5" role="group" aria-label={title}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
          <h3 className="text-label uppercase">{title}</h3>
        </div>
        {badge}
      </div>
      <div>
        <p className="font-mono text-title-lg font-semibold tabular-nums text-foreground">{value ?? '—'}</p>
        <p className="mt-1 text-body-sm text-muted-foreground">{detail}</p>
      </div>
      {meter}
      <div className="mt-auto">
        {series.loading ? (
          <Skeleton className="h-[148px] w-full" />
        ) : reason ? (
          <p className="flex h-[148px] items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-body-sm text-muted-foreground">
            {reason}
          </p>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

function UsageMeter({ label, share, band }: { label: string; share: number; band: UsageBand }) {
  const shown = Math.min(100, Math.max(0, share));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={`${formatShare(share)} of the limit`}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      {/* Never narrower than a sliver: an idle app still shows that the meter is live. */}
      <div className={`h-full rounded-full ${BAND_FILL[band]}`} style={{ width: `max(${shown}%, 4px)` }} />
    </div>
  );
}

function BandBadge({ band }: { band: UsageBand }) {
  if (band === 'unknown') return null;
  const Icon = band === 'ok' ? CheckCircle2 : AlertTriangle;
  return (
    <span className={`inline-flex items-center gap-1 text-body-sm font-medium ${band === 'ok' ? 'text-success' : BAND_TEXT[band]}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      {USAGE_BAND_LABEL[band]}
    </span>
  );
}

export function ResourceUsageSection({ projectName, env }: ResourceUsageSectionProps) {
  const [range, setRange] = useState<RangeValue>('1h');
  const cpu = useMetricsRange(projectName, { signal: 'cpu_usage', range, env });
  const cpuLimitSeries = useMetricsRange(projectName, { signal: 'cpu_limit', range: '1h', env });
  const memory = useMetricsRange(projectName, { signal: 'memory_usage', range, env });
  const memoryLimitSeries = useMetricsRange(projectName, { signal: 'memory_limit', range: '1h', env });
  const restarts = useMetricsRange(projectName, { signal: 'restarts_1h', range, env });

  const cpuNow = latest(cpu);
  const cpuLimit = latest(cpuLimitSeries);
  const cpuShare = usageShare(cpuNow, cpuLimit);
  const memoryNow = latest(memory);
  const memoryLimit = latest(memoryLimitSeries);
  const memoryShare = usageShare(memoryNow, memoryLimit);
  const restartsNow = latest(restarts);
  const restarted = restartsNow !== null && Math.round(restartsNow) > 0;

  const againstLimit = (share: number | null, limitText: string | null) =>
    share !== null && limitText ? `${formatShare(share)} of the ${limitText} limit` : 'No limit set';

  return (
    <section aria-label="Resource usage" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-title-md font-semibold text-foreground">Resources</h2>
          <p className="text-body-sm text-muted-foreground">
            What the app consumes in {env}, summed over its replicas.
          </p>
        </div>
        <div role="group" aria-label="Time range" className="inline-flex gap-1 rounded-lg border border-border p-1">
          {RANGES.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={range === option.value ? 'secondary' : 'ghost'}
              aria-pressed={range === option.value}
              aria-label={option.name}
              onClick={() => setRange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ResourceCard
          icon={Cpu}
          title="CPU"
          value={formatCpu(cpuNow)}
          detail={againstLimit(cpuShare, formatCpu(cpuLimit))}
          series={cpu}
          badge={<BandBadge band={usageBand(cpuShare)} />}
          meter={cpuShare !== null ? <UsageMeter label="CPU used of the limit" share={cpuShare} band={usageBand(cpuShare)} /> : null}
        >
          <ResourceChart title="CPU" points={cpu.data} format={(v) => formatCpu(v) ?? '—'} limit={cpuLimit} nice={niceDecimal} />
        </ResourceCard>

        <ResourceCard
          icon={MemoryStick}
          title="Memory"
          value={formatBytes(memoryNow)}
          detail={againstLimit(memoryShare, formatBytes(memoryLimit))}
          series={memory}
          badge={<BandBadge band={usageBand(memoryShare)} />}
          meter={memoryShare !== null ? <UsageMeter label="Memory used of the limit" share={memoryShare} band={usageBand(memoryShare)} /> : null}
        >
          <ResourceChart title="Memory" points={memory.data} format={(v) => formatBytes(v) ?? '—'} limit={memoryLimit} nice={niceBytes} />
        </ResourceCard>

        <ResourceCard
          icon={RotateCw}
          title="Restarts"
          value={formatRestarts(restartsNow)}
          detail="Container restarts in the last hour"
          series={restarts}
          badge={
            restartsNow === null ? null : restarted ? (
              <span className="inline-flex items-center gap-1 text-body-sm font-medium text-destructive">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                Restarting
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-body-sm font-medium text-success">
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                Stable
              </span>
            )
          }
        >
          <ResourceChart title="Restarts" points={restarts.data} format={(v) => formatRestarts(v) ?? '—'} nice={(v) => Math.max(1, Math.ceil(v))} />
        </ResourceCard>
      </div>
    </section>
  );
}
