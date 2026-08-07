// RED test for theo#140: clicking "Continue with GitHub" does nothing visible
// — the page silently re-renders and the user is never sent to the provider.
//
// The cause is a branch in `submitOIDC` (src/pages/login.tsx):
//
//     if (!flow) { startLogin(); return; }
//
// When the Kratos flow has not resolved yet — a slow network, a cold Kratos, a
// flow that expired and is being re-fetched — the click kicks off a NEW login
// flow and returns WITHOUT submitting. Everything about that is invisible: no
// error, no spinner, no navigation. The re-render the reporter describes is the
// new flow arriving. The click was swallowed.
//
// It is a race, so it reproduces intermittently in a browser and looks like
// "sometimes the button just doesn't work". Here the race is made deterministic
// by holding the flow fetch open across the click.
//
// The intent behind the branch is right — you cannot POST without a flow id and
// CSRF token. What is missing is that the user's intent must SURVIVE the wait:
// once the flow lands, the pending provider choice should be submitted rather
// than discarded.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen, waitFor } from '@/test/render';

vi.mock('@/lib/http/config', () => ({
  API_URL: 'http://kratos.local',
  AUTH_URL: '',
  ENGINE_URL: '',
  ACCOUNTS_URL: '',
}));

vi.mock('@/lib/auth/session', () => ({
  getSession: vi.fn().mockResolvedValue(null),
  startLogin: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  clearToken: vi.fn(),
}));

const reportEventSpy = vi.fn();
vi.mock('@/lib/telemetry/rum', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/telemetry/rum')>()),
  reportEvent: (...args: unknown[]) => reportEventSpy(...args),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { LoginPage } from './login';

function flowFixture() {
  return {
    id: 'flow-1',
    ui: {
      action: 'http://kratos.local/self-service/login?flow=flow-1',
      method: 'POST',
      nodes: [
        {
          group: 'default',
          attributes: { name: 'csrf_token', type: 'hidden', value: 'csrf-abc' },
        },
      ],
      messages: [],
    },
  };
}

describe('login OIDC — click before the flow resolves (theo#140)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_oidc_click_before_flow_ready_still_reaches_provider', async () => {
    // Hold the flow fetch open so the click lands while `flow` is still null —
    // the exact window the reporter hit.
    let releaseFlow: (v: unknown) => void = () => undefined;
    const pendingFlow = new Promise((resolve) => {
      releaseFlow = resolve;
    });
    mockFetch.mockReturnValueOnce(
      pendingFlow.then(() => ({ ok: true, json: async () => flowFixture() })),
    );

    const submitStub = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined);

    const user = userEvent.setup();
    render(<LoginPage />);

    const button = await screen.findByRole('button', {
      name: /continue with github/i,
    });
    await user.click(button); // flow is still null here

    // Now the flow arrives, exactly as it does in the browser.
    releaseFlow(null);

    await waitFor(
      () => {
        expect(submitStub).toHaveBeenCalled();
      },
      {
        timeout: 2000,
        onTimeout: (err) => {
          err.message =
            'Clicking "Continue with GitHub" before the login flow resolved never submitted ' +
            'to the provider (theo#140).\n' +
            '    submitOIDC hits `if (!flow) { startLogin(); return; }`, which starts a NEW flow ' +
            'and DISCARDS the click.\n' +
            '    The user sees a silent re-render and no navigation — no error, no spinner, ' +
            'nothing to retry against.\n' +
            '    The guard itself is correct (no POST without flow id + CSRF); what is missing ' +
            'is that the pending\n' +
            '    provider choice must survive the wait and submit once the flow lands.';
          return err;
        },
      },
    );

    // And it must be the RIGHT provider — resuming with the wrong one would be
    // a worse bug than not resuming at all.
    const forms = Array.from(document.querySelectorAll('form'));
    const oidcForm = forms.find((f) => f.method.toLowerCase() === 'post');
    expect(oidcForm).toBeTruthy();
    if (oidcForm) {
      const inputs = Array.from(
        oidcForm.querySelectorAll('input[type=hidden]'),
      ) as HTMLInputElement[];
      const bag = Object.fromEntries(inputs.map((i) => [i.name, i.value]));
      expect(bag.method).toBe('oidc');
      expect(bag.provider).toBe('github');
      expect(bag.csrf_token).toBe('csrf-abc');
    }

    submitStub.mockRestore();
  });

  // Um clique do usuario e UMA tentativa. Retomar o clique quando o flow chega nao pode
  // emitir um segundo `auth.method.attempt`: `startAuthAttempt` sobrescreve
  // `authCtxRef.current` com um novo correlation_id, entao o primeiro contexto fica ORFAO —
  // nenhum evento de desfecho jamais o carrega. O invariante de funnel-stitting declarado em
  // login.tsx:40 quebra exatamente na coorte de rede lenta que esta correcao existe para
  // atender, e a conversao dessa coorte passa a parecer pior do que e.
  it('test_slow_flow_click_emits_exactly_one_auth_attempt', async () => {
    let releaseFlow: (v: unknown) => void = () => undefined;
    const pendingFlow = new Promise((resolve) => {
      releaseFlow = resolve;
    });
    mockFetch.mockReturnValueOnce(
      pendingFlow.then(() => ({ ok: true, json: async () => flowFixture() })),
    );
    const submitStub = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined);

    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(
      await screen.findByRole('button', { name: /continue with github/i }),
    );
    releaseFlow(null);
    await waitFor(() => expect(submitStub).toHaveBeenCalled(), { timeout: 2000 });

    const attempts = reportEventSpy.mock.calls.filter(
      ([event]) => event === 'auth.method.attempt',
    );
    expect(attempts).toHaveLength(1);
    expect((attempts[0]?.[1] as { method?: string })?.method).toBe('github');

    submitStub.mockRestore();
  });

  it('test_oidc_click_after_flow_ready_is_unchanged', async () => {
    // Guard against "fix the race, break the normal path": with the flow
    // already present the click must submit immediately, not wait for anything.
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });

    const submitStub = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined);

    const user = userEvent.setup();
    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole('button', { name: /continue with github/i }),
    );

    await waitFor(() => {
      expect(submitStub).toHaveBeenCalled();
    });

    submitStub.mockRestore();
  });
});
