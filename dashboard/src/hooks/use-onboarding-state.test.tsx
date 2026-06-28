import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const mockUseWhoami = vi.fn();
const mockUseProjects = vi.fn();
const mockUseEngineApi = vi.fn();
const mockUseDeployments = vi.fn();

vi.mock('@/hooks/use-whoami', () => ({ useWhoami: () => mockUseWhoami() }));
vi.mock('@/hooks/use-projects', () => ({ useProjects: () => mockUseProjects() }));
vi.mock('@/hooks/use-api', () => ({
  useEngineApi: (path: string) => mockUseEngineApi(path),
  useCloudApi: () => ({ data: null, loading: false, error: false }),
}));
vi.mock('@/hooks/use-deployments', () => ({
  useDeployments: () => mockUseDeployments(),
}));

import { useOnboardingState, ONBOARDING_KEY } from './use-onboarding-state';

beforeEach(() => {
  localStorage.clear();
  mockUseWhoami.mockReset();
  mockUseProjects.mockReset();
  mockUseEngineApi.mockReset();
  mockUseDeployments.mockReset();
  mockUseWhoami.mockReturnValue({ whoami: null, loading: false, error: false });
  mockUseProjects.mockReturnValue({ projects: [], loading: false });
  mockUseEngineApi.mockReturnValue({ data: { domains: [] }, loading: false, error: false });
  mockUseDeployments.mockReturnValue({ builds: [], loading: false, error: false });
});

describe('useOnboardingState (Sprint 3 T3.1)', () => {
  it('test_returns_zero_completed_for_fresh_session', () => {
    const { result } = renderHook(() => useOnboardingState());
    expect(result.current.completed).toBe(0);
    expect(result.current.total).toBe(5);
    expect(result.current.percent).toBe(0);
  });

  it('test_marks_logged_in_when_session_active', () => {
    mockUseWhoami.mockReturnValue({ whoami: { email: 'a@b.com' }, loading: false, error: false });
    const { result } = renderHook(() => useOnboardingState());
    expect(result.current.state.steps.logged_in).toBe(true);
    expect(result.current.completed).toBeGreaterThanOrEqual(1);
  });

  it('test_marks_project_initialized_when_projects_nonempty', () => {
    mockUseProjects.mockReturnValue({ projects: [{ name: 'p1' }], loading: false });
    const { result } = renderHook(() => useOnboardingState());
    expect(result.current.state.steps.project_initialized).toBe(true);
  });

  it('test_marks_deploy_succeeded_when_any_succeeded_build', () => {
    mockUseDeployments.mockReturnValue({
      builds: [{ status: 'succeeded' }],
      loading: false,
      error: false,
    });
    const { result } = renderHook(() => useOnboardingState());
    expect(result.current.state.steps.deploy_succeeded).toBe(true);
  });

  it('test_dismiss_persists_in_localStorage', () => {
    const { result } = renderHook(() => useOnboardingState());
    act(() => result.current.dismiss());
    expect(result.current.state.dismissed).toBe(true);
    expect(localStorage.getItem(ONBOARDING_KEY)).toContain('"dismissed":true');
  });

  it('test_replay_clears_dismissed_flag', () => {
    const { result } = renderHook(() => useOnboardingState());
    act(() => result.current.dismiss());
    act(() => result.current.replay());
    expect(result.current.state.dismissed).toBe(false);
  });

  it('test_isVisible_false_when_dismissed', () => {
    const { result } = renderHook(() => useOnboardingState());
    act(() => result.current.dismiss());
    expect(result.current.isVisible).toBe(false);
  });

  it('test_isVisible_false_when_all_complete', () => {
    mockUseWhoami.mockReturnValue({ whoami: { email: 'a@b.com' }, loading: false, error: false });
    mockUseProjects.mockReturnValue({ projects: [{ name: 'p' }], loading: false });
    mockUseDeployments.mockReturnValue({ builds: [{ status: 'succeeded' }], loading: false, error: false });
    mockUseEngineApi.mockReturnValue({
      data: { domains: [{ domain: 'a.com' }] },
      loading: false,
      error: false,
    });
    const { result } = renderHook(() => useOnboardingState());
    act(() => result.current.markStepDone('cli_installed'));
    expect(result.current.completed).toBe(5);
    expect(result.current.isVisible).toBe(false);
  });

  // EC-04: localStorage failures handled gracefully
  it('test_safeGet_returns_default_when_localStorage_throws', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn(() => {
      throw new Error('SecurityError');
    });
    try {
      const { result } = renderHook(() => useOnboardingState());
      expect(result.current.completed).toBe(0);
      expect(result.current.state.dismissed).toBe(false);
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it('test_safeGet_returns_default_when_json_corrupted', () => {
    localStorage.setItem(ONBOARDING_KEY, 'not-valid-json{{{');
    const { result } = renderHook(() => useOnboardingState());
    expect(result.current.state.dismissed).toBe(false);
  });

  it('test_safeSet_does_not_throw_on_quotaExceeded', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error('QuotaExceeded');
    });
    try {
      const { result } = renderHook(() => useOnboardingState());
      expect(() => act(() => result.current.dismiss())).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  // EC-06: replay must show widget when the user hasn't fully completed
  // the auto-derived steps yet. Use a pre-deploy scenario so cli_installed
  // depends on the persisted flag (the Red Team theo-cloud#56 auto-flip
  // requires a successful deploy, which this scenario does NOT have).
  it('test_replay_resets_completion_when_already_complete', () => {
    mockUseWhoami.mockReturnValue({ whoami: { email: 'a@b.com' }, loading: false, error: false });
    mockUseProjects.mockReturnValue({ projects: [{ name: 'p' }], loading: false });
    // No deploys yet → cli_installed is governed by the user-confirmed flag.
    mockUseDeployments.mockReturnValue({ builds: [], loading: false, error: false });
    mockUseEngineApi.mockReturnValue({
      data: { domains: [{ domain: 'a.com' }] },
      loading: false,
      error: false,
    });
    const { result } = renderHook(() => useOnboardingState());
    act(() => result.current.markStepDone('cli_installed'));
    // Whoami + project + cli + domain = 4 (deploy not done yet).
    expect(result.current.completed).toBe(4);
    act(() => result.current.replay());
    // After replay: cli_installed reset to false (user-confirmed step),
    // deploy stays auto-false. completed=3, isVisible=true.
    expect(result.current.state.steps.cli_installed).toBe(false);
    expect(result.current.isVisible).toBe(true);
  });

  // EC-14: cli_installed must NOT auto-mark
  it('test_cli_installed_only_via_markStepDone_not_auto', () => {
    mockUseWhoami.mockReturnValue({ whoami: { email: 'a@b.com' }, loading: false, error: false });
    const { result } = renderHook(() => useOnboardingState());
    expect(result.current.state.steps.cli_installed).toBe(false);
    act(() => result.current.markStepDone('cli_installed'));
    expect(result.current.state.steps.cli_installed).toBe(true);
  });

  // Red Team theo-cloud#56 closure: a SUCCEEDED build is rigorous proof
  // the user installed the CLI (no other path writes to the engine), so
  // cli_installed MUST auto-flip true when deploy_succeeded does. The
  // EC-14 user-confirmed rule still applies BEFORE a deploy lands: the
  // CTA stays available for the pre-deploy phase.
  it('cli_installed auto-flips when a deploy succeeded (#56)', () => {
    mockUseWhoami.mockReturnValue({
      whoami: { email: 'a@b.com' },
      loading: false,
      error: false,
    });
    mockUseProjects.mockReturnValue({
      projects: [{ name: 'theokit-example', apps: [] }],
      loading: false,
    });
    mockUseDeployments.mockReturnValue({
      builds: [{ id: 'b1', status: 'succeeded' }],
      loading: false,
    });
    const { result } = renderHook(() => useOnboardingState());
    expect(result.current.state.steps.deploy_succeeded).toBe(true);
    expect(result.current.state.steps.cli_installed).toBe(true);
  });
});
