import { Clock, Layers } from 'lucide-react';

interface EnvironmentKPIRowProps {
  /** The ready replicas the API last read for the environment. Absent: never read. */
  replicasReady?: number | null;
  /** When that reading was taken, ISO 8601. */
  replicasReadyAt?: string | null;
  /** ISO timestamp of the last successful deploy. */
  lastDeploy?: string | null;
  /** Commit of the last deploy. */
  lastDeploySha?: string | null;
  /**
   * The current time in epoch ms. An input, not read inside: the React Compiler keeps a
   * computation whose inputs did not change, so a time read inside would never advance.
   */
  nowMs: number;
}

/** A reading older than this says nothing about the environment now. Ten poller intervals. */
const READING_MAX_AGE_MS = 5 * 60 * 1000;
const NO_READING = 'Ready replicas: no reading in the last 5 minutes';

/**
 * The health cells of one row of the Environments table: the ready replicas and the last
 * deploy. A value the API did not answer is a dash, never a zero, which would read as
 * "nothing runs".
 */
export function EnvironmentKPIRow({
  replicasReady,
  replicasReadyAt,
  lastDeploy,
  lastDeploySha,
  nowMs,
}: EnvironmentKPIRowProps) {
  const replicas = freshReplicas(replicasReady, replicasReadyAt, nowMs);
  return (
    <div className="flex items-center gap-4 text-label">
      <span
        className="inline-flex items-center gap-1 tabular-nums text-muted-foreground"
        title={replicas === null ? NO_READING : 'Ready replicas'}
      >
        <Layers className="size-3" aria-hidden="true" />
        <span>{replicas === null ? '—' : `${replicas} replica${replicas !== 1 ? 's' : ''}`}</span>
      </span>
      <span
        className="inline-flex items-center gap-1 tabular-nums text-muted-foreground"
        title={
          lastDeploy
            ? `Last deploy: ${new Date(lastDeploy).toLocaleString()}`
            : 'No deploys yet'
        }
      >
        <Clock className="size-3" aria-hidden="true" />
        <span>{formatLastDeploy(lastDeploy, lastDeploySha, nowMs)}</span>
      </span>
    </div>
  );
}

/** The ready replicas when their reading is recent, null otherwise. */
function freshReplicas(
  replicas: number | null | undefined,
  readAt: string | null | undefined,
  nowMs: number,
): number | null {
  if (replicas === undefined || replicas === null || !readAt) return null;
  const at = Date.parse(readAt);
  if (Number.isNaN(at) || nowMs - at > READING_MAX_AGE_MS) return null;
  return replicas;
}

function formatLastDeploy(
  lastDeploy: string | null | undefined,
  sha: string | null | undefined,
  nowMs: number,
): string {
  if (!lastDeploy) return '—';
  const ts = new Date(lastDeploy).getTime();
  if (Number.isNaN(ts)) return '—';
  const rel = relativeFromMs(nowMs - ts);
  return sha ? `${rel} (${sha.slice(0, 7)})` : rel;
}

function relativeFromMs(ms: number): string {
  if (ms < 0) return 'in the future';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
