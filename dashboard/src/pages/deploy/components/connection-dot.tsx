import { Wifi, WifiOff } from 'lucide-react';

/** Where the live-updates stream of a deploy stands. */
export type StreamState = 'connected' | 'reconnecting' | 'ended';

/**
 * A deploy that is live, failed or canceled sends nothing more and its stream
 * is closed, so there is no connection to report.
 */
export function streamStateOf(overall: string, connected: boolean): StreamState {
  if (overall === 'live' || overall === 'failed' || overall === 'canceled') return 'ended';
  return connected ? 'connected' : 'reconnecting';
}

/** The live-updates indicator of the deploy timeline. Renders nothing once the deploy ended. */
export function ConnectionDot({ state }: { state: StreamState }) {
  if (state === 'ended') return null;
  const connected = state === 'connected';
  const label = connected ? 'Live updates connected' : 'Reconnecting…';
  const Icon = connected ? Wifi : WifiOff;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      title={label}
      aria-label={label}
    >
      <Icon size={12} aria-hidden="true" />
      <span
        aria-hidden="true"
        className={[
          'h-1.5 w-1.5 rounded-full',
          connected ? 'bg-emerald-500 motion-safe:animate-pulse' : 'bg-muted-foreground',
        ].join(' ')}
      />
    </span>
  );
}
