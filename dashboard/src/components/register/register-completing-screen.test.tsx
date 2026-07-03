import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/render';

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
});
