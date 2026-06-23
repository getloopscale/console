import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button, Card, PageShell } from '@usetheo/ui';
import { useSetPageTitle } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { useLogStream } from '@/hooks/use-log-stream';
import { LogViewer } from '@/components/logs/log-viewer';
import { TimeRangePicker } from '@/components/logs/time-range-picker';

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
  useSetPageTitle(`${name} · Runtime logs`);
  const [paused, setPaused] = useState(false);
  // J-19 T1.1: time-range selector (default last 5 minutes). Drives `?since=`.
  const [selectedRange, setSelectedRange] = useState('5m');

  const streamPath = name
    ? `/engine/api/v1/projects/${encodeURIComponent(name)}/logs/stream?env=production&since=${selectedRange}`
    : null;
  const { lines, connected, error, clear } = useLogStream(streamPath, { paused });

  return (
    <PageShell
      title="Runtime logs"
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
        <TimeRangePicker value={selectedRange} onChange={setSelectedRange} />
      </div>

      <Card className="overflow-hidden">
        <div className="h-[640px]">
          <LogViewer
            lines={lines}
            connected={connected}
            error={error}
            paused={paused}
            onTogglePause={() => setPaused((p) => !p)}
            onClear={clear}
          />
        </div>
      </Card>
    </PageShell>
  );
}
