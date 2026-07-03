import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@/test/render';
import { ResendCooldownButton } from './resend-cooldown-button';

// M0 J-03 T1.1 — ResendCooldownButton. A resend affordance that enforces a 60s
// cooldown PERSISTED in localStorage (survives reload / remount), so a user who
// reloads the verification page cannot spam Kratos with resend requests. Time is
// made deterministic with fake timers (testing.md § 6 — no wall-clock in units).

const KEY = 'theo-verify-resend-until';

describe('ResendCooldownButton', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:00Z'));
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('test_renders_idle_resend_button_enabled_when_no_cooldown_stored', () => {
    render(<ResendCooldownButton onResend={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /didn't receive the email\? resend/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeEnabled();
  });

  it('test_click_calls_onResend_once_and_starts_persisted_cooldown', () => {
    const onResend = vi.fn();
    render(<ResendCooldownButton onResend={onResend} />);
    fireEvent.click(screen.getByRole('button', { name: /resend/i }));

    expect(onResend).toHaveBeenCalledTimes(1);
    // Deadline persisted ~60s in the future.
    const until = parseInt(localStorage.getItem(KEY) ?? '0', 10);
    expect(until).toBe(Date.now() + 60_000);
    // Now shows a disabled countdown.
    const btn = screen.getByRole('button', { name: /resend available in 60 seconds/i });
    expect(btn).toBeDisabled();
  });

  it('test_restores_cooldown_from_localStorage_on_mount', () => {
    // A prior resend left a 30s-remaining deadline before this (re)mount.
    localStorage.setItem(KEY, String(Date.now() + 30_000));
    const onResend = vi.fn();
    render(<ResendCooldownButton onResend={onResend} />);

    expect(screen.getByRole('button', { name: /resend available in 30 seconds/i })).toBeDisabled();
    // Mounting in cooldown must NOT trigger a resend.
    expect(onResend).not.toHaveBeenCalled();
  });

  it('test_cooldown_counts_down_and_reenables_at_zero', () => {
    const onResend = vi.fn();
    render(<ResendCooldownButton onResend={onResend} cooldownSeconds={3} />);
    fireEvent.click(screen.getByRole('button', { name: /resend/i }));
    expect(screen.getByRole('button', { name: /resend available in 3 seconds/i })).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Re-enabled, idle label back, storage cleared.
    const btn = screen.getByRole('button', { name: /didn't receive the email\? resend/i });
    expect(btn).toBeEnabled();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('test_expired_deadline_in_storage_renders_idle', () => {
    localStorage.setItem(KEY, String(Date.now() - 5_000)); // already elapsed
    render(<ResendCooldownButton onResend={vi.fn()} />);
    expect(screen.getByRole('button', { name: /didn't receive the email\? resend/i })).toBeEnabled();
  });
});
