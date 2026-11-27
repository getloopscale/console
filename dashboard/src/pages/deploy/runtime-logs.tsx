import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button, Card, PageShell, Select } from '@getloopscale/ui';
import { useSetPageTitle } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { useEnvironments } from '@/hooks/use-environments';
import { useLogStream } from '@/hooks/deploy/use-log-stream';
import { LogViewer } from '@/pages/deploy/components/log-viewer';
import { TimeRangePicker } from '@/pages/deploy/components/time-range-picker';

/**
 * RuntimeLogsPage — Plan v1.0 T2.1 + J-19 T1.1 (TimeRangePicker wire).
 *
 * Streams runtime logs from /api/v1/projects/{name}/logs/stream?env=production&since={range}
 * via SSE. Reuses LogViewer composite + useLogStream hook from Phase 1. The
 * `?since=` query is driven by the TimeRangePicker dropdown; `env=production`
 * precedes `since` (canonical query order). Mock emitter (handlers.ts) keeps
 * emitting lines indefinitely (vs build logs which finish after 10 lines).
 */
export function RuntimeLogsPage() {
  useRequireAuth();
  const { name = '' } = useParams<{ name: string }>();
  useSetPageTitle(`${name} · Logs`);
  const [paused, setPaused] = useState(false);
  // J-19 T1.1: time-range selector (default last 5 minutes). Drives `?since=`.
  const [selectedRange, setSelectedRange] = useState('5m');
  // M16: env selector — logs were hardwired to production, so a project whose
  // only deploys are in preview/staging streamed an empty viewer forever.
  const { envs } = useEnvironments(name);
  const [env, setEnv] = useState('production');

  const streamPath = name
    ? `/engine/api/v1/projects/${encodeURIComponent(name)}/logs/stream?env=${encodeURIComponent(env)}&since=${selectedRange}`
    : null;
  const { lines, connected, error, droppedCount, clear } = useLogStream(streamPath, { paused });

  return (
    <PageShell
      title="Logs"
      description={`Live log stream for ${name}.`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link
            to={`/projects/${encodeURIComponent(name)}`}
            className="inline-flex items-center gap-1"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span>Back to project</span>
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          {envs.length > 0 ? (
            <Select value={env} onValueChange={setEnv}>
              <Select.Trigger className="w-[160px]" aria-label="Environment">
                <Select.Value placeholder="Environment" />
              </Select.Trigger>
              <Select.Content>
                {envs.map((e) => (
                  <Select.Item key={e} value={e}>
                    {e}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          ) : null}
          <TimeRangePicker value={selectedRange} onChange={setSelectedRange} />
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="h-[640px]">
          <LogViewer
            lines={lines}
            connected={connected}
            error={error}
            paused={paused}
            droppedCount={droppedCount}
            onTogglePause={() => setPaused((p) => !p)}
            onClear={clear}
          />
        </div>
      </Card>
    </PageShell>
  );
}
