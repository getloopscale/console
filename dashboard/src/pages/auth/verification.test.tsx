import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/render';

vi.mock('@/lib/http/config', () => ({
  API_URL: 'http://kratos.local',
  AUTH_URL: '',
  ENGINE_URL: '',
  ACCOUNTS_URL: '',
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { VerificationPage } from './verification';

describe('VerificationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    // Defense-in-depth (testing.md § 6): the page mounts ResendCooldownButton,
    // which reads a localStorage deadline. Clear it so the "resend enabled on
    // fresh mount" assertion never depends on cross-test state.
    localStorage.clear();
  });

  it('test_verification_renders_email_input', async () => {
    // Mount with ?flow=abc (no code) → enters "input" state showing the form.
    render(<VerificationPage />, { initialEntries: ['/verification?flow=abc'] });
    await waitFor(() => {
      expect(screen.getByLabelText('Verification code')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /^verify$/i })).toBeInTheDocument();
  });

  // M0 J-03 T1.1 wiring — the input state renders the ResendCooldownButton
  // (localStorage-persisted 60s cooldown) in place of the old naked resend
  // link. T1.2 (paste distribution) is satisfied by the @usetheo/ui PinInput
  // primitive natively (its docstring: "Paste handling fills all slots from
  // clipboard") — building a wrapper would reinvent it (Rule 9), so it is not
  // re-tested here (don't test third-party libraries). T1.3 (auto-submit on
  // 6 digits) is the PinInput `onComplete` wired to submitCode (line 245),
  // exercised by test_verification_submit_triggers_send.
  it('test_verification_input_state_wires_resend_cooldown_button', async () => {
    render(<VerificationPage />, { initialEntries: ['/verification?flow=abc'] });
    await waitFor(() => {
      expect(screen.getByLabelText('Verification code')).toBeInTheDocument();
    });
    // The resend affordance is the cooldown button (enabled on a fresh mount
    // with no prior deadline in localStorage).
    const resend = screen.getByRole('button', { name: /didn't receive the email\? resend/i });
    expect(resend).toBeInTheDocument();
    expect(resend).toBeEnabled();
  });

  it('test_verification_submit_triggers_send', async () => {
    // Mount with ?flow=abc&code=123456 → useEffect fires submitCode → 2 fetches
    // (flow lookup + submit). First fetch loads flow JSON; second posts code.
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ui: {
            action: 'http://kratos.local/self-service/verification?flow=abc',
            nodes: [{ attributes: { name: 'csrf_token', value: 'csrf-xyz' } }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: 'passed_challenge' }),
      });

    render(<VerificationPage />, {
      initialEntries: ['/verification?flow=abc&code=123456'],
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
    const [submitUrl, submitOpts] = mockFetch.mock.calls[1];
    expect(submitUrl).toBe('http://kratos.local/self-service/verification?flow=abc');
    const body = JSON.parse(submitOpts.body);
    expect(body.method).toBe('code');
    expect(body.code).toBe('123456');
    expect(body.csrf_token).toBe('csrf-xyz');
  });

  it('test_verification_success_state_after_send', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ui: {
            action: 'http://kratos.local/self-service/verification?flow=abc',
            nodes: [{ attributes: { name: 'csrf_token', value: 'csrf-xyz' } }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: 'passed_challenge' }),
      });

    render(<VerificationPage />, {
      initialEntries: ['/verification?flow=abc&code=999000'],
    });

    await waitFor(() => {
      expect(screen.getByText('Email verified')).toBeInTheDocument();
    });
    expect(screen.getByText(/Your account is now fully active/i)).toBeInTheDocument();
  });

  // M0 J-03 acceptance — NEGATIVE case (testing.md § 4.1): an invalid/expired code
  // must fail-clear (typed error surfaced, NOT a silent success) AND stay
  // retryable (PinInput + Verify button remain — status returns to 'input',
  // never 'success'). Pre-fix the only coverage was the happy passed_challenge
  // path; the error branch (verification.tsx:130-141) was untested.
  it('test_verification_invalid_code_shows_error_and_stays_retryable', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ui: {
            action: 'http://kratos.local/self-service/verification?flow=abc',
            nodes: [{ attributes: { name: 'csrf_token', value: 'csrf-xyz' } }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        // Kratos returns the flow with an error message instead of passed_challenge.
        json: async () => ({
          ui: {
            messages: [
              { id: 4070006, type: 'error', text: 'The verification code is invalid or has expired. Please try again.' },
            ],
          },
        }),
      });

    render(<VerificationPage />, {
      initialEntries: ['/verification?flow=abc&code=000000'],
    });

    // The error Alert surfaces (fail-clear) — the destructive Alert title carries
    // the (enriched) Kratos message.
    await waitFor(() => {
      expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();
    });
    // NOT a silent success.
    expect(screen.queryByText('Email verified')).not.toBeInTheDocument();
    // Stays retryable: the code input + Verify button remain (status === 'input').
    expect(screen.getByLabelText('Verification code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^verify$/i })).toBeInTheDocument();
  });

  // M0 J-03 acceptance — NEGATIVE case: an EXPIRED verification link (the flow
  // lookup itself 4xx/5xx, distinct from a wrong code) must land in the terminal
  // 'error' state with the "request a new one" guidance — not a blank screen or a
  // silent success. Covers verification.tsx:106-110 (flowResp not ok).
  it('test_verification_expired_link_shows_terminal_error', async () => {
    // First fetch (flow lookup) fails → expired-link error path.
    mockFetch.mockResolvedValueOnce({ ok: false, status: 410, json: async () => ({}) });

    render(<VerificationPage />, {
      initialEntries: ['/verification?flow=stale&code=123456'],
    });

    await waitFor(() => {
      expect(screen.getByText(/verification link expired/i)).toBeInTheDocument();
    });
    // Terminal error state — NOT success, and only the flow lookup was attempted
    // (no code POST against a dead flow).
    expect(screen.queryByText('Email verified')).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
