import { Card } from '@getloopscale/ui';
import { useSandboxMetricsSeries } from '@/hooks/sandboxes/use-sandboxes';
import { ResourceChart } from '@/pages/projects/components/resource-chart';
import { niceBytes, niceDecimal } from '@/pages/projects/components/resource-chart-geometry';
import { formatBytes, formatCpu } from '@/pages/projects/components/resource-format';
import { cpuPoints, valuePoints } from '@/lib/sandboxes/metrics-series';
import { sandboxFailure } from './sandbox-labels';

function Resource({ title, now, children }: { title: string; now: string; children: React.ReactNode }) {
  return (
    <Card>
      <Card.Body className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-body-sm font-medium text-foreground">{title}</h3>
          <span className="text-label text-muted-foreground tabular-nums" data-testid={`${title.toLowerCase()}-now`}>
            {now}
          </span>
        </div>
        {children}
      </Card.Body>
    </Card>
  );
}

const ofLimit = (used: string | null, limit: string | null) => (used && limit ? `${used} of ${limit}` : (used ?? '—'));

/** CPU, memory and disk of the sandbox since this tab was first opened. */
export function MonitoringTab({ id, active }: { id: string; active: boolean }) {
  const metrics = useSandboxMetricsSeries(id, active);
  const series = metrics.data ?? [];
  const last = series[series.length - 1];
  const cpu = cpuPoints(series);
  const memory = valuePoints(series, (s) => s.memory_used_bytes);
  const disk = valuePoints(series, (s) => s.disk_used_bytes);

  if (metrics.isError && series.length === 0) {
    return (
      <p role="alert" className="pt-4 text-body-sm text-destructive">
        Could not read the metrics: {sandboxFailure(metrics.error)}
      </p>
    );
  }

  return (
    <div className="space-y-3 pt-4">
      <p className="text-label text-muted-foreground">
        One sample every 3 seconds, kept while this page is open. The charts start when the tab is first
        opened.
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Resource title="CPU" now={formatCpu(cpu[cpu.length - 1]?.v) ?? 'Waiting for a second sample'}>
          <ResourceChart title="CPU" points={cpu} format={(v) => formatCpu(v) ?? '—'} nice={niceDecimal} />
        </Resource>
        <Resource
          title="Memory"
          now={ofLimit(formatBytes(last?.memory_used_bytes), formatBytes(last?.memory_limit_bytes))}
        >
          <ResourceChart
            title="Memory"
            points={memory}
            format={(v) => formatBytes(v) ?? '—'}
            limit={last?.memory_limit_bytes}
            nice={niceBytes}
          />
        </Resource>
        <Resource
          title="Disk"
          now={
            last && last.disk_limit_bytes === undefined
              ? 'Not reported while paused'
              : ofLimit(formatBytes(last?.disk_used_bytes), formatBytes(last?.disk_limit_bytes))
          }
        >
          <ResourceChart
            title="Disk"
            points={disk}
            format={(v) => formatBytes(v) ?? '—'}
            limit={last?.disk_limit_bytes}
            nice={niceBytes}
          />
        </Resource>
      </div>
    </div>
  );
}
