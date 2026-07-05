import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@/test/render';

vi.mock('@/hooks/use-provisioning-status', () => ({ useProvisioningStatus: vi.fn() }));

import { RegisterCompletingScreen } from './register-completing-screen';
import { useProvisioningStatus } from '@/hooks/use-provisioning-status';

const mockedHook = vi.mocked(useProvisioningStatus);

beforeEach(() => {
  vi.clearAllMocks();
});

// M0 J-02 T3.1 — the post-registration "completing" screen. It waits (spinner)
// while the tenant's after-registration bootstrap is `pending`, then calls
// onReady once provisioning resolves (active — or a terminal unknown/absent,
// all of which mean "stop waiting, go to the dashboard"). An already-provisioned
// user redirects immediately (active on first load), so wiring it into the
// session-success branch is a no-op pass-through for existing sessions.
describe('RegisterCompletingScreen (M0 J-02 T3.1)', () => {
  it('test_shows_setup_spinner_while_pending_and_does_not_redirect', () => {
    mockedHook.mockReturnValue({ status: 'pending', loading: false });
    const onReady = vi.fn();
    render(<RegisterCompletingScreen onReady={onReady} />);

    expect(screen.getByRole('heading', { name: /setting up your workspace/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/setting up your account/i)).toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();
  });

  it('test_calls_onReady_when_provisioning_active', () => {
    mockedHook.mockReturnValue({ status: 'active', plan: 'starter', loading: false });
    const onReady = vi.fn();
    render(<RegisterCompletingScreen onReady={onReady} />);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('test_calls_onReady_on_terminal_unknown', () => {
    mockedHook.mockReturnValue({ status: 'unknown', loading: false });
    const onReady = vi.fn();
    render(<RegisterCompletingScreen onReady={onReady} />);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('test_does_not_redirect_while_still_loading', () => {
    mockedHook.mockReturnValue({ status: undefined, loading: true });
    const onReady = vi.fn();
    render(<RegisterCompletingScreen onReady={onReady} />);
    expect(onReady).not.toHaveBeenCalled();
  });

  // EC-2 (>60s) + EC-1 (stuck/failed → escape): if provisioning stays `pending`
  // past the bounded wait, the screen surfaces a "taking longer" warning with a
  // Continue-to-dashboard escape, instead of an infinite spinner.
  describe('bounded wait (EC-1 + EC-2)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('test_after_max_wait_still_pending_shows_taking_longer_warning', () => {
      mockedHook.mockReturnValue({ status: 'pending', loading: false });
      render(<RegisterCompletingScreen onReady={vi.fn()} maxWaitMs={5000} />);
      // Before the deadline: normal spinner, no warning.
      expect(screen.queryByText(/taking longer/i)).not.toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(5000); });
      // After the deadline while still pending: warning + escape CTA.
      expect(screen.getByText(/taking longer/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /continue to dashboard/i })).toBeInTheDocument();
    });

    it('test_timeout_continue_button_calls_onReady', () => {
      mockedHook.mockReturnValue({ status: 'pending', loading: false });
      const onReady = vi.fn();
      render(<RegisterCompletingScreen onReady={onReady} maxWaitMs={5000} />);
      act(() => { vi.advanceTimersByTime(5000); });
      fireEvent.click(screen.getByRole('button', { name: /continue to dashboard/i }));
      expect(onReady).toHaveBeenCalledTimes(1);
    });

    it('test_no_warning_when_resolves_before_deadline', () => {
      // active on first render → onReady fires, and even past the deadline no
      // warning is shown (not pending anymore).
      mockedHook.mockReturnValue({ status: 'active', loading: false });
      const onReady = vi.fn();
      render(<RegisterCompletingScreen onReady={onReady} maxWaitMs={5000} />);
      act(() => { vi.advanceTimersByTime(5000); });
      expect(screen.queryByText(/taking longer/i)).not.toBeInTheDocument();
      expect(onReady).toHaveBeenCalled();
    });
  });
});
