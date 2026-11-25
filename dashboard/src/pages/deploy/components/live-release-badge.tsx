import { useEffect, useState } from 'react';
import { Ban, Check, Globe2, Loader2 } from 'lucide-react';

/**
 * LiveReleaseBadge — dev-friendly "what is live RIGHT NOW" confirmation.
 *
 * Vercel/Linear pattern: after a deploy completes, the user wants a
 * persistent at-a-glance answer to "did it actually go live?" without
 * needing to open kubectl / DB / DevTools. The badge sits in the
 * DeployTimelineHero footer and surfaces three signals together:
 *
 *   1. **Serving** — the live URL responded 200 (proves the
 *      deployment infrastructure synced + workloads are accepting
 *      requests; we do NOT mention ArgoCD, pods, or sync per
 *      Cross-Project Rule 9).
 *   2. **Commit fingerprint** — short SHA + clickable to GitHub.
 *   3. **Time-since** — how long ago the canonical release became
 *      active (drives "did we actually rollback recently?" UX).
 *
 * Rollback semantics: when the hero is rendering the timeline of a
 * deploy that was later rolled back, this badge stays attached to
 * the ACTIVE release (resolved from useProjectStatus), so the user
 * sees the FRESHEST live state regardless of which historical build
 * they navigated into. That matches the Vercel deploy-detail flow.
 *
 * A build that failed or was cancelled never rolls out. For it the badge
 * says so and names the release that is still serving, instead of the
 * "Rolling out…" spinner, which would contradict the failure above it.
 */

export interface LiveReleaseBadgeProps {
  /** True when the canonical timeline reached live/completed. */
  isLive: boolean;
  /** True when the build on this page failed or was cancelled, so it will never go live. */
  notDeployed?: boolean;
  /** Short hash (7 chars) of the active release commit. */
  commitShort?: string | null;
  /** ISO timestamp of when the release became active. */
  activeSince?: string | null;
  /** Live URL that's currently serving (probe target). */
  liveUrl?: string | null;
  /** GitHub repo URL for commit link (optional). */
  repoUrl?: string | null;
  className?: string;
}

export function LiveReleaseBadge({
  isLive,
  notDeployed = false,
  commitShort,
  activeSince,
  liveUrl,
  repoUrl,
  className,
}: LiveReleaseBadgeProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!activeSince) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [activeSince]);

  if (!isLive && !commitShort) return null;

  const state = isLive ? 'serving' : notDeployed ? 'not-deployed' : 'rolling-out';
  const Icon = state === 'serving' ? Check : state === 'not-deployed' ? Ban : Loader2;
  const tone =
    state === 'serving'
      ? 'bg-emerald-50/70 ring-emerald-500/30 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100'
      : state === 'not-deployed'
        ? 'bg-muted/60 ring-border text-foreground'
        : 'bg-blue-50/70 ring-blue-500/30 text-blue-900 dark:bg-blue-950/30 dark:text-blue-100';
  const label =
    state === 'serving'
      ? 'Serving'
      : state === 'not-deployed'
        ? commitShort
          ? 'This build did not deploy. Still serving'
          : 'This build did not deploy'
        : 'Rolling out…';
  const sinceLabel = activeSince ? relativeTime(activeSince, now) : null;

  return (
    <div
      className={[
        'mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md ring-1 ring-inset px-3 py-2 text-xs',
        tone,
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid="live-release-badge"
      data-state={state}
    >
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Icon
          size={14}
          className={state === 'rolling-out' ? 'motion-safe:animate-spin' : ''}
          aria-hidden="true"
        />
        <span>{label}</span>
      </span>

      {commitShort ? (
        repoUrl ? (
          <a
            href={`${repoUrl.replace(/\.git$/, '')}/commit/${commitShort}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono tabular-nums underline-offset-2 hover:underline"
          >
            <span aria-hidden="true">·</span>
            <code>{commitShort}</code>
          </a>
        ) : (
          <span className="inline-flex items-center gap-1 font-mono tabular-nums">
            <span aria-hidden="true">·</span>
            <code>{commitShort}</code>
          </span>
        )
      ) : null}

      {liveUrl ? (
        <a
          href={liveUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline-offset-2 hover:underline truncate max-w-[24ch]"
          title={liveUrl}
        >
          <Globe2 size={12} aria-hidden="true" />
          <span className="truncate">{stripScheme(liveUrl)}</span>
        </a>
      ) : null}

      {sinceLabel ? (
        <span
          className="ml-auto inline-flex items-center text-[11px] opacity-80 tabular-nums"
          aria-label={`Active since ${sinceLabel}`}
        >
          <time dateTime={activeSince ?? undefined}>{sinceLabel}</time>
        </span>
      ) : null}
    </div>
  );
}

function relativeTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const delta = Math.max(0, Math.floor((now - t) / 1000));
  if (delta < 60) return `live ${delta}s ago`;
  if (delta < 3600) return `live ${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) {
    const h = Math.floor(delta / 3600);
    const m = Math.floor((delta % 3600) / 60);
    return m === 0 ? `live ${h}h ago` : `live ${h}h ${m}m ago`;
  }
  const d = Math.floor(delta / 86400);
  return `live ${d}d ago`;
}

function stripScheme(u: string): string {
  return u.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
