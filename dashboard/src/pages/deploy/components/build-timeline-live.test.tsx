import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BuildTimelineLive } from './build-timeline-live';
import type { BuildStep } from '@/hooks/deploy/sse-events';
import type { UseDeploymentStreamResult } from '@/hooks/deploy/use-deployment-stream';

vi.mock('@/hooks/deploy/use-deployment-stream', () => ({
  useDeploymentStream: vi.fn(),
}));

import { useDeploymentStream } from '@/hooks/deploy/use-deployment-stream';

const mockedStream = vi.mocked(useDeploymentStream);

function streamResult(overrides: Partial<UseDeploymentStreamResult> = {}): UseDeploymentStreamResult {
  return {
    steps: [],
    currentStep: null,
    totalDurationSeconds: null,
    status: 'queued',
    error: null,
    connected: true,
    lastEventID: null,
    ...overrides,
  };
}

function renderTimeline(buildId = 'b-1', projectName = 'teste', restBuildStatus?: import('@/lib/api/types').BuildStatus) {
  return render(
    <MemoryRouter>
      <BuildTimelineLive
        buildId={buildId}
        projectName={projectName}
        restBuildStatus={restBuildStatus}
      />
    </MemoryRouter>,
  );
}

describe('BuildTimelineLive', () => {
  beforeEach(() => {
    mockedStream.mockReset();
  });

  it('test_renders_skeleton_when_no_events', () => {
    mockedStream.mockReturnValue(streamResult({ status: 'queued' }));
    renderTimeline();

    expect(screen.getByLabelText(/waiting for build to start/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting for build to start/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // Red Team theo-cloud#122 surface 1 — when a build dies BEFORE any SSE
  // step event (e.g. Argo submit Unauthorized), `steps.length === 0` made
  // the component render the Skeleton "Waiting for build to start… /
  // Connecting to build stream…" forever — contradicting the header's
  // "Failed" badge and the BuildErrorPanel below it. The REST build.status
  // is now plumbed via `restBuildStatus` so the timeline can emit an
  // honest "Build failed before any step ran" terminal-empty state instead.
  it('Red Team theo-cloud#122 — failed build + zero events shows honest terminal-empty state (no skeleton)', () => {
    mockedStream.mockReturnValue(streamResult({ status: 'queued', steps: [] }));
    renderTimeline('b-1', 'teste', 'failed');

    // Pre-fix: the misleading "Waiting for build to start" / "Connecting"
    // skeleton was rendered for FAILED builds. Post-fix it MUST NOT.
    expect(screen.queryByLabelText(/waiting for build to start/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/connecting to build stream/i)).not.toBeInTheDocument();
    // Post-fix MUST show an explicit honest empty state for the failed terminal.
    expect(screen.getByText(/build failed before any step ran/i)).toBeInTheDocument();
  });

  // Negative-axis: a still-queued build (REST status === 'queued') with no
  // SSE events yet KEEPS the skeleton — that's a legitimate in-flight empty
  // state, not a #122 contradiction. Preserves the existing UX for the
  // canonical happy-path "waiting for build to start" window.
  it('Red Team theo-cloud#122 — queued build + zero events still shows skeleton (happy-path preserved)', () => {
    mockedStream.mockReturnValue(streamResult({ status: 'queued', steps: [] }));
    renderTimeline('b-1', 'teste', 'queued');

    expect(screen.getByLabelText(/waiting for build to start/i)).toBeInTheDocument();
    expect(screen.queryByText(/build failed before any step ran/i)).not.toBeInTheDocument();
  });

  it('test_renders_step_card_per_event', () => {
    const steps: BuildStep[] = [
      {
        step_name: 'clone-repo',
        phase_group: 'clone',
        status: 'succeeded',
        started_at: '2026-06-06T00:00:00Z',
        ended_at: '2026-06-06T00:00:05Z',
        duration_seconds: 5,
      },
      {
        step_name: 'install-deps',
        phase_group: 'install',
        status: 'succeeded',
        started_at: '2026-06-06T00:00:05Z',
        ended_at: '2026-06-06T00:00:30Z',
        duration_seconds: 25,
      },
    ];
    mockedStream.mockReturnValue(
      streamResult({ steps, status: 'running', currentStep: steps[1] }),
    );
    renderTimeline();

    expect(screen.getByText(/clone repo/i)).toBeInTheDocument();
    expect(screen.getByText(/install deps/i)).toBeInTheDocument();
    // review F-tests-6/7: done mapeado + timer no slot timestamp ('5s')
    const done = screen.getByText(/clone repo/i).closest('[data-slot="stepper-step"]');
    expect(done?.getAttribute('data-state')).toBe('done');
    expect(done?.querySelector('[data-slot="stepper-timestamp"]')?.textContent).toContain('5s');
  });

  it('test_current_step_has_live_indicator', () => {
    const running: BuildStep = {
      step_name: 'build-image',
      phase_group: 'build',
      status: 'running',
      started_at: '2026-06-06T00:00:00Z',
    };
    mockedStream.mockReturnValue(
      streamResult({
        steps: [running],
        status: 'running',
        currentStep: running,
      }),
    );
    renderTimeline();

    // M7 T2.2 (+review F-tests-3): contrato estável da lib — data-slot + aria-current,
    // sem acoplar em classes internas.
    const item = screen.getByText(/build image/i).closest('[data-slot="stepper-step"]');
    expect(item?.getAttribute('data-state')).toBe('active');
    expect(item?.getAttribute('aria-current')).toBe('step');
  });

  it('test_failed_step_shows_error', () => {
    const failed: BuildStep = {
      step_name: 'build-image',
      phase_group: 'build',
      status: 'failed',
      started_at: '2026-06-06T00:00:00Z',
      ended_at: '2026-06-06T00:01:00Z',
      duration_seconds: 60,
      error_class: 'OOM',
      error_message: 'Container exited 137',
      suggestion: 'Increase plan resources',
    };
    mockedStream.mockReturnValue(
      streamResult({
        steps: [failed],
        status: 'failed',
        currentStep: failed,
        error: {
          step_name: failed.step_name,
          error_class: 'OOM',
          error_message: failed.error_message ?? '',
          suggestion: failed.suggestion ?? '',
        },
      }),
    );
    renderTimeline();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    // review F-tests-5/7: a causa da falha aparece NO step (description do Stepper)
    // e o item carrega data-state=failed
    const failedItem = screen.getByText(/build image/i).closest('[data-slot="stepper-step"]');
    expect(failedItem?.getAttribute('data-state')).toBe('failed');
    expect(failedItem?.textContent).toContain('failed: OOM');
    expect(screen.getByText(/out of memory/i)).toBeInTheDocument();
    expect(screen.getByText(/increase plan resources/i)).toBeInTheDocument();
    expect(screen.queryByText(/deploy complete/i)).not.toBeInTheDocument();
  });

  it('test_all_succeeded_shows_celebration', () => {
    const steps: BuildStep[] = [
      {
        step_name: 'clone-repo',
        phase_group: 'clone',
        status: 'succeeded',
        started_at: '2026-06-06T00:00:00Z',
        ended_at: '2026-06-06T00:00:05Z',
        duration_seconds: 5,
      },
    ];
    mockedStream.mockReturnValue(
      streamResult({
        steps,
        status: 'succeeded',
        currentStep: steps[0],
        totalDurationSeconds: 5,
      }),
    );
    renderTimeline();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/deploy complete/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('test_groups_steps_by_phase', () => {
    const steps: BuildStep[] = [
      {
        step_name: 'clone-repo',
        phase_group: 'clone',
        status: 'succeeded',
        started_at: '2026-06-06T00:00:00Z',
        ended_at: '2026-06-06T00:00:05Z',
        duration_seconds: 5,
      },
      {
        step_name: 'install-deps',
        phase_group: 'install',
        status: 'succeeded',
        started_at: '2026-06-06T00:00:05Z',
        ended_at: '2026-06-06T00:00:30Z',
        duration_seconds: 25,
      },
      {
        step_name: 'build-image',
        phase_group: 'build',
        status: 'succeeded',
        started_at: '2026-06-06T00:00:30Z',
        ended_at: '2026-06-06T00:01:30Z',
        duration_seconds: 60,
      },
      {
        step_name: 'sign-image',
        phase_group: 'sign',
        status: 'succeeded',
        started_at: '2026-06-06T00:01:30Z',
        ended_at: '2026-06-06T00:01:35Z',
        duration_seconds: 5,
      },
      {
        step_name: 'push-manifest',
        phase_group: 'deliver',
        status: 'succeeded',
        started_at: '2026-06-06T00:01:35Z',
        ended_at: '2026-06-06T00:01:40Z',
        duration_seconds: 5,
      },
    ];
    mockedStream.mockReturnValue(
      streamResult({
        steps,
        status: 'succeeded',
        currentStep: steps[steps.length - 1],
        totalDurationSeconds: 100,
      }),
    );
    renderTimeline();

    // Each phase has its own labelled <section>.
    expect(screen.getByLabelText(/clone phase/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/install phase/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/build phase/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sign phase/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/deliver phase/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/other phase/i)).not.toBeInTheDocument();
  });

  it('test_unknown_step_renders_in_other_group_EC11', () => {
    // EC-11: backend can introduce a novel step before UI is updated;
    // PhaseGroupForStep returns "other" as fallback. Front MUST NOT crash
    // and MUST render the step under the Other phase group.
    const steps: BuildStep[] = [
      {
        step_name: 'novel-step',
        phase_group: 'other',
        status: 'running',
        started_at: '2026-06-06T00:00:00Z',
      },
    ];
    mockedStream.mockReturnValue(
      streamResult({
        steps,
        status: 'running',
        currentStep: steps[0],
      }),
    );
    renderTimeline();

    expect(screen.getByLabelText(/other phase/i)).toBeInTheDocument();
    expect(screen.getByText(/novel step/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/clone phase/i)).not.toBeInTheDocument();
  });
});

describe('BuildTimelineLive and a build that ended', () => {
  beforeEach(() => {
    mockedStream.mockReset();
    mockedStream.mockReturnValue(streamResult());
  });

  it.each(['succeeded', 'failed', 'cancelled'] as const)('tells the stream a %s build has ended', (status) => {
    renderTimeline('b-1', 'teste', status);

    expect(mockedStream).toHaveBeenCalledWith('b-1', expect.objectContaining({ ended: true }));
  });

  it.each(['queued', 'running', 'cancelling', undefined] as const)('keeps the stream of a %s build open', (status) => {
    renderTimeline('b-1', 'teste', status);

    expect(mockedStream).toHaveBeenCalledWith('b-1', expect.objectContaining({ ended: false }));
  });
});
