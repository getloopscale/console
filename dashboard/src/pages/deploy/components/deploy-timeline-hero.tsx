import { ConnectionDot, streamStateOf } from '@/pages/deploy/components/connection-dot';
import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  CircleDashed,
  Loader2,
  X,
  AlertTriangle,
  Ban,
} from 'lucide-react';
import { useDeployTimelineWithSteps } from '@/hooks/deploy/use-deploy-timeline-with-steps';
import type { PhaseState, OverallStatus, PhaseStep } from '@/hooks/deploy/use-deploy-timeline';
import {
  PHASE_LABEL,
  PHASE_DEFAULT_SUBSTATE,
  type PhaseStatus,
} from '@/hooks/deploy/deploy-timeline-events';
import { LiveReleaseBadge } from './live-release-badge';
import { buildNeverDeployed } from '@/pages/deploy/build-outcome';

/**
 * DeployTimelineHero — Plan deploy-timeline-canonical-5-phases (UI).
 *
 * Vercel-inspired 5-phase deploy visualization rendered above the
 * deployment detail body. Five horizontally-aligned PhaseCell tiles
 * separated by ↘ arrows on desktop; vertically stacked on mobile.
 *
 * FAANG UX patterns applied:
 *   - Progressive disclosure: cell collapses to {status icon · phase
 *     name · duration}; substateMessage shown beneath on ≥md.
 *   - Status semantics: icon + label + color (not color alone) for a11y.
 *   - Live duration ticks only on the active in_progress phase; frozen
 *     once terminal — single setInterval scoped to the active cell.
 *   - Connection state visible (subtle pulse dot, not anxious).
 *   - Reduced motion respected via `motion-safe:animate-pulse`.
 *   - Semantic `<ol>` with `aria-current="step"` on the in_progress cell.
 *   - aria-live="polite" region announces phase + status transitions to
 *     screen readers without interrupting.
 *   - Truncation strategy: substateMessage line-clamps to 2 lines on
 *     desktop, 1 on mobile; degraded reason shown in an inline banner.
 *   - Color tokens come from the shared design system (no raw hex).
 */

export interface DeployTimelineHeroProps {
  deployId: string;
  /** Optional Last-Event-ID hint seeded from a REST snapshot. */
  initialLastEventID?: string | null;
  /** Freeze updates while a parent modal is open, etc. */
  paused?: boolean;
  /** The build record's status: a failed build may have no timeline events at all. */
  buildStatus?: string;
  /** The build record's `deploy_status`: how the rollout of this build ended, when it has. */
  deployStatus?: string;
  /**
   * Optional live-release evidence rendered in the hero footer.
   * Sourced from /projects/{name}/status active_release — represents
   * the canonical "what is serving production right now" state which
   * may differ from the deploy being navigated when the user is
   * looking at a historical or rolled-back build.
   */
  liveRelease?: {
    commitShort?: string | null;
    activeSince?: string | null;
    url?: string | null;
    repoUrl?: string | null;
  };
  className?: string;
}

export function DeployTimelineHero({
  deployId,
  initialLastEventID,
  paused,
  buildStatus,
  deployStatus,
  liveRelease,
  className,
}: DeployTimelineHeroProps) {
  const {
    phases,
    aggregatorDegradedReason,
    overall,
    connected,
  } = useDeployTimelineWithSteps(deployId, { initialLastEventID, paused, buildStatus, deployStatus });

  const streamState = streamStateOf(overall, connected);

  // For aria-live: announce only the latest phase/status transition.
  const live = describeOverall(overall, phases);

  return (
    <section
      className={[
        'rounded-lg border border-border/60 bg-card p-4 sm:p-5',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Deploy timeline"
      data-overall={overall}
      data-stream={streamState}
      data-testid="deploy-timeline-hero"
    >
      <header className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <OverallStatusPill overall={overall} />
          <span className="text-sm text-muted-foreground">
            {totalElapsedLabel(phases)}
          </span>
        </div>
        <ConnectionDot state={streamState} />
      </header>

      {aggregatorDegradedReason ? (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p className="leading-snug">{aggregatorDegradedReason}</p>
        </div>
      ) : null}

      <ol
        className="grid gap-3 md:grid-cols-5"
        data-testid="deploy-timeline-phases"
      >
        {phases.map((cell, idx) => (
          <PhaseCell
            key={cell.phase}
            cell={cell}
            isLast={idx === phases.length - 1}
          />
        ))}
      </ol>

      {liveRelease && (liveRelease.commitShort || liveRelease.activeSince) ? (
        <LiveReleaseBadge
          isLive={overall === 'live'}
          notDeployed={buildNeverDeployed(overall, buildStatus)}
          commitShort={liveRelease.commitShort}
          activeSince={liveRelease.activeSince}
          liveUrl={liveRelease.url}
          repoUrl={liveRelease.repoUrl}
        />
      ) : null}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {live}
      </p>
    </section>
  );
}

/* PhaseCell ---------------------------------------------------------------- */

interface PhaseCellProps {
  cell: PhaseState;
  isLast: boolean;
}

function PhaseCell({ cell, isLast }: PhaseCellProps) {
  const tone = toneFor(cell.status);
  const Icon = iconFor(cell.status);
  const isActive = cell.status === 'in_progress';
  const isTerminal =
    cell.status === 'completed' ||
    cell.status === 'failed' ||
    cell.status === 'canceled';
  const isDegraded = cell.status === 'degraded';
  const hasSteps = cell.steps.length > 0;
  // Auto-open while the phase is the live one or recently failed; user
  // toggle is sticky after first click via the explicit state.
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const defaultExpanded = isActive || cell.status === 'failed';
  const expanded = expandedOverride ?? defaultExpanded;
  const detailId = `phase-${cell.phase}-steps`;

  return (
    <li
      className={[
        'relative rounded-md border px-3 py-3 transition-colors',
        tone.surface,
        tone.border,
        // In-progress: extra emphasis — primary-tinted ring halo + thicker left
        // accent so the active phase is unmistakable across the 5-cell row.
        isActive
          ? 'ring-2 ring-info/30 border-l-4 border-l-info shadow-sm'
          : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-current={isActive ? 'step' : undefined}
      data-phase={cell.phase}
      data-status={cell.status}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={[
              'relative inline-flex h-5 w-5 items-center justify-center rounded-full',
              isActive ? 'bg-info/15 ring-1 ring-info/40' : '',
            ].join(' ')}
          >
            {isActive ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-full bg-info/40 motion-safe:animate-ping"
              />
            ) : null}
            <Icon
              size={isActive ? 17 : 16}
              className={[
                'relative',
                tone.icon,
                isActive ? 'motion-safe:animate-spin' : '',
              ].join(' ')}
              aria-hidden="true"
            />
          </span>
          <span
            className={[
              'text-sm',
              isActive ? 'font-semibold text-info' : 'font-medium',
              !isActive ? tone.label : '',
            ].join(' ')}
          >
            {PHASE_LABEL[cell.phase]}
          </span>
          {hasSteps ? (
            <span
              className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 rounded-full bg-muted/60 text-[10px] font-medium tabular-nums text-muted-foreground"
              aria-label={`${cell.steps.length} steps`}
              data-testid={`phase-step-count-${cell.phase}`}
            >
              {cell.steps.length}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <PhaseDuration cell={cell} />
          {hasSteps ? (
            <button
              type="button"
              className="rounded-md p-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={expanded}
              aria-controls={detailId}
              aria-label={
                expanded ? `Hide ${PHASE_LABEL[cell.phase]} steps` : `Show ${PHASE_LABEL[cell.phase]} steps`
              }
              onClick={() => setExpandedOverride(!expanded)}
              data-testid={`phase-toggle-${cell.phase}`}
            >
              <ChevronDown
                size={14}
                className={[
                  'transition-transform motion-safe:duration-150',
                  expanded ? 'rotate-180' : '',
                ].join(' ')}
                aria-hidden="true"
              />
            </button>
          ) : null}
        </div>
      </div>

      {(cell.substateMessage || cell.status !== 'pending') && (
        <p
          className="mt-1.5 line-clamp-2 text-xs text-muted-foreground"
          title={cell.substateMessage ?? undefined}
        >
          {cell.substateMessage ?? PHASE_DEFAULT_SUBSTATE[cell.phase]}
        </p>
      )}

      {isDegraded && cell.degradedReason ? (
        <p className="mt-2 text-xs text-warning line-clamp-2">
          {cell.degradedReason}
        </p>
      ) : null}

      {isTerminal && cell.status === 'failed' && cell.degradedReason ? (
        <p className="mt-2 text-xs text-destructive line-clamp-2">
          {cell.degradedReason}
        </p>
      ) : null}

      {hasSteps && expanded ? (
        <ol
          id={detailId}
          className="mt-3 space-y-1.5 border-t border-border/40 pt-2"
          data-testid={`phase-steps-${cell.phase}`}
        >
          {cell.steps.map((step) => (
            <StepRow key={step.name} step={step} />
          ))}
        </ol>
      ) : null}

      {!isLast && (
        <span
          aria-hidden="true"
          className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
        >
          →
        </span>
      )}
    </li>
  );
}

/* StepRow — single step inside an expanded PhaseCell ---------------------- */

function StepRow({ step }: { step: PhaseStep }) {
  const isRunning = step.status === 'running';
  const isFailed = step.status === 'failed';
  const isSucceeded = step.status === 'succeeded';
  const Icon = isSucceeded ? Check : isFailed ? X : Loader2;
  const tone = isSucceeded
    ? 'text-success'
    : isFailed
      ? 'text-destructive'
      : 'text-info';
  return (
    <li
      className={[
        'group relative flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs transition-colors',
        // Running: emphatic highlight — left accent bar + tinted bg + ring halo + animate-pulse layer.
        isRunning
          ? 'bg-info/10 ring-1 ring-inset ring-info/30 border-l-2 border-l-info'
          : isFailed
            ? 'bg-destructive/10'
            : 'hover:bg-muted/40',
      ].join(' ')}
      data-step-name={step.name}
      data-step-status={step.status}
      aria-current={isRunning ? 'step' : undefined}
    >
      {/* Pulse halo behind the icon for running steps (purely decorative). */}
      {isRunning ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0.5 top-1/2 -translate-y-1/2 inline-flex h-3 w-3 rounded-full bg-info/30 motion-safe:animate-ping"
        />
      ) : null}
      <span className="relative flex items-center gap-1.5 min-w-0">
        <span
          className={[
            'relative inline-flex h-4 w-4 items-center justify-center rounded-full',
            isRunning ? 'bg-info/15 ring-1 ring-info/40' : '',
          ].join(' ')}
        >
          <Icon
            size={isRunning ? 13 : 12}
            className={[
              tone,
              isRunning ? 'motion-safe:animate-spin' : '',
            ].join(' ')}
            aria-hidden="true"
          />
        </span>
        <span
          className={[
            'truncate',
            isRunning ? 'font-semibold text-info' : 'font-medium',
          ].join(' ')}
          title={step.name}
        >
          {humanizeStepName(step.name)}
        </span>
        {isRunning ? (
          <span className="sr-only">in progress</span>
        ) : null}
      </span>
      <span
        className={[
          'font-mono tabular-nums shrink-0',
          isRunning ? 'text-info' : 'text-muted-foreground',
        ].join(' ')}
      >
        <StepDuration step={step} />
      </span>
    </li>
  );
}

/* StepDuration — live ticking for running steps; frozen otherwise --------- */

function StepDuration({ step }: { step: PhaseStep }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (step.status !== 'running') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [step.status]);

  if (step.durationSeconds != null) {
    return <>{formatDuration(step.durationSeconds)}</>;
  }
  if (!step.startedAt) return <>…</>;
  const start = Date.parse(step.startedAt);
  if (!Number.isFinite(start)) return <>…</>;
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  return <>{formatDuration(seconds)}</>;
}

function humanizeStepName(name: string): string {
  // Strip noisy suffixes + replace dashes with spaces, capitalize first.
  const stripped = name.replace(/[-_]/g, ' ');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/* PhaseDuration — live tick only on in_progress; frozen otherwise --------- */

function PhaseDuration({ cell }: { cell: PhaseState }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (cell.status !== 'in_progress' && cell.status !== 'degraded') return;
    if (!cell.startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [cell.status, cell.startedAt]);

  if (!cell.startedAt) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const start = Date.parse(cell.startedAt);
  if (!Number.isFinite(start)) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const end = cell.endedAt ? Date.parse(cell.endedAt) : now;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return (
    <time
      dateTime={`PT${seconds}S`}
      className="font-mono text-xs tabular-nums text-muted-foreground"
    >
      {formatDuration(seconds)}
    </time>
  );
}

/* OverallStatusPill -------------------------------------------------------- */

function OverallStatusPill({ overall }: { overall: OverallStatus }) {
  const label = overallLabel(overall);
  const tone = overallTone(overall);
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        tone,
      ].join(' ')}
      data-overall={overall}
    >
      {overallIcon(overall)}
      {label}
    </span>
  );
}

/* Helpers ------------------------------------------------------------------ */

function iconFor(status: PhaseState['status']) {
  switch (status) {
    case 'completed':
      return Check;
    case 'in_progress':
      return Loader2;
    case 'failed':
      return X;
    case 'canceled':
      return Ban;
    case 'degraded':
      return AlertTriangle;
    case 'ready':
    case 'pending':
    default:
      return CircleDashed;
  }
}

interface ToneTokens {
  surface: string;
  border: string;
  icon: string;
  label: string;
}

function toneFor(status: PhaseState['status']): ToneTokens {
  switch (status) {
    case 'completed':
      return {
        surface: 'bg-success/10',
        border: 'border-success/40',
        icon: 'text-success',
        label: 'text-foreground',
      };
    case 'in_progress':
      return {
        surface: 'bg-info/10',
        border: 'border-info/50',
        icon: 'text-info',
        label: 'text-foreground',
      };
    case 'failed':
      return {
        surface: 'bg-destructive/10',
        border: 'border-destructive/50',
        icon: 'text-destructive',
        label: 'text-foreground',
      };
    case 'canceled':
      return {
        surface: 'bg-muted/30',
        border: 'border-muted',
        icon: 'text-muted-foreground',
        label: 'text-foreground',
      };
    case 'degraded':
      return {
        surface: 'bg-warning/10',
        border: 'border-warning/50',
        icon: 'text-warning',
        label: 'text-foreground',
      };
    case 'ready':
    case 'pending':
    default:
      return {
        surface: 'bg-card/40',
        border: 'border-dashed border-border/60',
        icon: 'text-muted-foreground/70',
        label: 'text-muted-foreground',
      };
  }
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

function totalElapsedLabel(phases: PhaseState[]): string {
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  for (const p of phases) {
    if (p.startedAt) {
      const s = Date.parse(p.startedAt);
      if (Number.isFinite(s) && s < start) start = s;
    }
    if (p.endedAt) {
      const e = Date.parse(p.endedAt);
      if (Number.isFinite(e) && e > end) end = e;
    }
  }
  if (!Number.isFinite(start) || end <= 0) return 'Awaiting events';
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return `${formatDuration(seconds)} total`;
}

function overallLabel(overall: OverallStatus): string {
  switch (overall) {
    case 'live':
      return 'Live';
    case 'running':
      return 'Deploying';
    case 'queued':
      return 'Queued';
    case 'failed':
      return 'Failed';
    case 'canceled':
      return 'Canceled';
    case 'degraded':
      return 'Degraded';
    default:
      return 'Unknown';
  }
}

function overallTone(overall: OverallStatus): string {
  switch (overall) {
    case 'live':
      return 'bg-success/10 text-success ring-success/30';
    case 'running':
      return 'bg-info/10 text-info ring-info/30';
    case 'queued':
      return 'bg-muted text-muted-foreground ring-border';
    case 'failed':
      return 'bg-destructive/10 text-destructive ring-destructive/30';
    case 'canceled':
      return 'bg-muted text-muted-foreground ring-border';
    case 'degraded':
      return 'bg-warning/10 text-warning ring-warning/30';
    default:
      return 'bg-muted text-muted-foreground ring-border';
  }
}

function overallIcon(overall: OverallStatus) {
  switch (overall) {
    case 'live':
      return <Check size={12} aria-hidden="true" />;
    case 'running':
      return <Loader2 size={12} aria-hidden="true" className="motion-safe:animate-spin" />;
    case 'failed':
      return <X size={12} aria-hidden="true" />;
    case 'canceled':
      return <Ban size={12} aria-hidden="true" />;
    case 'degraded':
      return <AlertTriangle size={12} aria-hidden="true" />;
    case 'queued':
    default:
      return <CircleDashed size={12} aria-hidden="true" />;
  }
}

function statusToLabel(status: PhaseStatus | 'pending'): string {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'in_progress':
      return 'in progress';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'canceled';
    case 'degraded':
      return 'degraded';
    case 'ready':
      return 'ready';
    default:
      return 'pending';
  }
}

function describeOverall(overall: OverallStatus, phases: PhaseState[]): string {
  // Find the current non-pending phase for the live-region narration.
  const active =
    phases.find((p) => p.status === 'in_progress' || p.status === 'degraded') ??
    [...phases].reverse().find((p) => p.status !== 'pending') ??
    phases[0];
  return `Deploy ${overall}. ${PHASE_LABEL[active.phase]} ${statusToLabel(active.status)}.`;
}
