import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen, waitFor } from '@/test/render';

vi.mock('@/lib/http/config', () => ({
  API_URL: 'https://auth-dev.usetheo.dev',
  AUTH_URL: '',
  ACCOUNTS_URL: '',
}));

vi.mock('@/lib/auth/session', () => ({
  getSession: vi.fn().mockResolvedValue(null),
  startLogin: vi.fn(),
}));

vi.mock('@/lib/http/api', () => ({
}));

// Mock @/lib/rum to assert telemetry wire-points (T2.2).
const mockReportEvent = vi.fn();
vi.mock('@/lib/telemetry/rum', async () => {
  const actual = await vi.importActual<typeof import('@/lib/telemetry/rum')>('@/lib/telemetry/rum');
  return {
    ...actual,
    reportEvent: (...args: unknown[]) => mockReportEvent(...args),
  };
});

// Stub fetch BEFORE module import — login useEffect fires fetch on mount.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { LoginPage } from './login';

interface FlowMessage {
  text: string;
  type: string;
}
interface FlowFixture {
  id: string;
  ui: {
    action: string;
    method: string;
    nodes: Array<{
      group: string;
      attributes: { name?: string; type?: string; value?: string };
    }>;
    messages: FlowMessage[];
  };
}

function flowFixture(): FlowFixture {
  return {
    id: 'flow-1',
    ui: {
      action: 'https://auth-dev.usetheo.dev/self-service/login?flow=flow-1',
      method: 'POST',
      nodes: [
        { group: 'default', attributes: { name: 'csrf_token', type: 'hidden', value: 'csrf-abc' } },
        { group: 'password', attributes: { name: 'identifier', type: 'email' } },
        { group: 'password', attributes: { name: 'password', type: 'password' } },
      ],
      messages: [],
    },
  };
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockReportEvent.mockReset();
  });

  it('test_login_loads_kratos_flow', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => flowFixture(),
    });
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /continue with github/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('test_login_submit_password_calls_kratos', async () => {
    // Rewritten 2026-06-05 (Ralph J-04 loop): code uses form.submit() top-level
    // POST per SameSite-Lax security fix 2026-06-01 (NOT fetch). Test asserts
    // form construction + submit invocation pattern, mirroring the canonical
    // test_login_oidc_form_submit_preserves_vanilla_dom approach.
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });

    const createElementSpy = vi.spyOn(document, 'createElement');
    const submitStub = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined);

    const user = userEvent.setup();
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Email'), 'u@x.com');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(submitStub).toHaveBeenCalled();
    });

    // Assert form was constructed (createElement called for 'form')
    const formCalls = createElementSpy.mock.calls.filter((c) => c[0] === 'form');
    expect(formCalls.length).toBeGreaterThanOrEqual(1);

    // B-197 — isto varria `document.querySelectorAll('form')` e pegava a PRIMEIRA que casasse.
    // O `cleanup()` do RTL remove só o container que ele criou; uma form que o código de produção
    // anexa direto no `body` sobrevive ao teste. Em ordem fixa o caso de OIDC vinha depois; sob
    // shuffle vinha antes, e este caso inspecionava a form DELE — `bag.method` era `'oidc'`.
    //
    // A form submetida é a que o stub recebeu como `this`. Ler dali é independente de ordem e é
    // também a afirmação mais forte: fala da form que foi ENVIADA, e não de uma que estava por
    // perto e casava com o seletor.
    const passwordForm = submitStub.mock.instances[submitStub.mock.instances.length - 1] as
      | HTMLFormElement
      | undefined;
    expect(passwordForm).toBeTruthy();
    if (passwordForm) {
      const inputs = Array.from(passwordForm.querySelectorAll('input[type=hidden]')) as HTMLInputElement[];
      const bag = Object.fromEntries(inputs.map((i) => [i.name, i.value]));
      expect(bag.method).toBe('password');
      expect(bag.identifier).toBe('u@x.com');
      expect(bag.password).toBe('secret123');
      expect(bag.csrf_token).toBe('csrf-abc');
    }

    createElementSpy.mockRestore();
    submitStub.mockRestore();
  });

  it('test_login_oidc_form_submit_preserves_vanilla_dom', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });

    // EC-4 invariant: OIDC handler MUST use document.createElement('form') +
    // form.submit() — substituting fetch breaks the OIDC redirect chain.
    const createElementSpy = vi.spyOn(document, 'createElement');
    const submitStub = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined);

    const user = userEvent.setup();
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /continue with github/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /continue with github/i }));

    const formCalls = createElementSpy.mock.calls.filter((c) => c[0] === 'form');
    expect(formCalls.length).toBeGreaterThanOrEqual(1);
    expect(submitStub).toHaveBeenCalled();

    createElementSpy.mockRestore();
    submitStub.mockRestore();
  });

  it('test_login_session_expired_alert_when_searchParams_reason', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    render(<LoginPage />, { initialEntries: ['/login?reason=expired'] });
    await waitFor(() => {
      expect(screen.getByText('Session expired')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // T1.1 — Generic error message + safeErrorDetail allow-list (D2)
  // =========================================================================

  it('test_login_error_message_is_generic', async () => {
    const flowWithError = flowFixture();
    flowWithError.ui.messages = [{ text: 'User not found.', type: 'error' }];
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowWithError });
    render(<LoginPage />);
    await waitFor(() => {
      // Generic title replaces raw Kratos text
      expect(screen.getByText("We couldn't sign you in.")).toBeInTheDocument();
    });
    // Raw text must NOT appear (OWASP A07)
    expect(screen.queryByText('User not found.')).not.toBeInTheDocument();
  });

  it('test_login_safe_detail_for_csrf_mismatch', async () => {
    const flowWithError = flowFixture();
    flowWithError.ui.messages = [{ text: 'The csrf_token is invalid.', type: 'error' }];
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowWithError });
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByText('Your session expired. Try again.')).toBeInTheDocument();
    });
  });

  it('test_login_safe_detail_priority_csrf_over_provider', async () => {
    // EC-2: errors with both provider AND csrf must surface csrf description
    const flowWithError = flowFixture();
    flowWithError.ui.messages = [
      { text: 'provider error from github', type: 'error' },
      { text: 'csrf invalid', type: 'error' },
    ];
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowWithError });
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByText('Your session expired. Try again.')).toBeInTheDocument();
    });
    expect(screen.queryByText('Try a different sign-in method.')).not.toBeInTheDocument();
  });

  it('test_login_safe_detail_handles_empty_text', async () => {
    // EC-3: null/empty text must not throw TypeError
    const flowWithError = flowFixture();
    flowWithError.ui.messages = [
      { text: '', type: 'error' },
      { text: null as unknown as string, type: 'error' },
    ];
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowWithError });
    expect(() => render(<LoginPage />)).not.toThrow();
    await waitFor(() => {
      expect(screen.getByText("We couldn't sign you in.")).toBeInTheDocument();
    });
  });

  // =========================================================================
  // T1.2 — autoFocus on email input (G2)
  // =========================================================================

  it('test_login_email_input_has_autofocus', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });
    expect(document.activeElement).toBe(screen.getByLabelText('Email'));
  });

  // =========================================================================
  // T1.3 — Visible network error feedback + HTTP 5xx gate (EC-1 MUST FIX)
  // =========================================================================

  it('test_login_network_error_shows_alert', async () => {
    // Rewritten 2026-06-05 (Ralph J-04 loop): code uses form.submit(); the
    // network-error path is the catch block around form.submit() which fires
    // on DOM/CSP edge cases (line 268-271 of login.tsx). Mock form.submit to
    // throw to exercise this path.
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });

    const submitStub = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => {
        throw new Error('CSP form-action violation');
      });

    const user = userEvent.setup();
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Email'), 'u@x.com');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Network error. Check your connection and try again.'),
      ).toBeInTheDocument();
    });

    submitStub.mockRestore();
  });

  // =========================================================================
  // B-096 — o DESFECHO da tentativa, do outro lado da navegacao
  //
  // Os oito `it.skip` que ocupavam este espaco descreviam, corretamente, uma
  // funcionalidade ausente: com `form.submit()` a pagina navega e o desfecho
  // acontece noutro render. Eles nao eram testes ruins — eram testes de algo que
  // nao existia. `lib/auth/auth-attempt.ts` e o elo que faltava, e o que segue
  // exercita o comportamento real em vez de descrever a lacuna.
  //
  // O ramo de SUCESSO nao mora aqui: ele acontece na pagina autenticada, em
  // `useRequireAuth`, e tem cobertura em `src/hooks/use-auth.test.tsx`.
  // =========================================================================

  it('B-096 — o Kratos recusar emite auth.method.failure com o MESMO correlation_id da tentativa', async () => {
    sessionStorage.clear();
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    mockFetch.mockResolvedValue({ ok: true, json: async () => flowFixture() });

    const user = userEvent.setup();
    const { unmount } = render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /continue with github/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /continue with github/i }));
    const tentativa = mockReportEvent.mock.calls.find((c) => c[0] === 'auth.method.attempt');
    const idDaTentativa = (tentativa![1] as Record<string, unknown>).correlation_id;

    // O `form.submit()` navega; na vida real a montagem seguinte e uma pagina
    // nova. Aqui desmontar e remontar reproduz isso — e e justamente o que o
    // `useRef` original nao sobrevivia.
    unmount();
    mockReportEvent.mockReset();
    const comErro = flowFixture();
    comErro.ui.messages = [{ type: 'error' as const, text: 'The provided credentials are invalid' }];
    mockFetch.mockResolvedValue({ ok: true, json: async () => comErro });
    render(<LoginPage />);

    await waitFor(() => {
      const falhas = mockReportEvent.mock.calls.filter((c) => c[0] === 'auth.method.failure');
      expect(falhas.length).toBe(1);
    });
    const payload = mockReportEvent.mock.calls.find((c) => c[0] === 'auth.method.failure')![1] as Record<string, unknown>;
    // O correlation_id atravessando a navegacao E o item: sem ele o evento de
    // desfecho nao liga na tentativa e o funil nao fecha.
    expect(payload.correlation_id).toBe(idDaTentativa);
    expect(payload.method).toBe('github');
    expect(payload.reason).toBe('kratos_validation');
    expect(typeof payload.latency_ms).toBe('number');
  });

  it('B-096 — um erro de CSRF e classificado como csrf_expired, nao como validacao', async () => {
    sessionStorage.clear();
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    mockFetch.mockResolvedValue({ ok: true, json: async () => flowFixture() });
    const user = userEvent.setup();
    const { unmount } = render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /continue with github/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /continue with github/i }));
    unmount();
    mockReportEvent.mockReset();

    const comCsrf = flowFixture();
    comCsrf.ui.messages = [{ type: 'error' as const, text: 'The CSRF token could not be found' }];
    mockFetch.mockResolvedValue({ ok: true, json: async () => comCsrf });
    render(<LoginPage />);

    await waitFor(() => {
      expect(mockReportEvent.mock.calls.filter((c) => c[0] === 'auth.method.failure').length).toBe(1);
    });
    const payload = mockReportEvent.mock.calls.find((c) => c[0] === 'auth.method.failure')![1] as Record<string, unknown>;
    // A distincao importa para quem le a metrica: credencial errada e problema
    // de quem entra; CSRF expirado e problema nosso, e some no meio do outro se
    // os dois virarem "kratos_validation".
    expect(payload.reason).toBe('csrf_expired');
  });

  it('B-096 — abrir a tela de erro SEM ter tentado nao emite falha', async () => {
    sessionStorage.clear();
    mockReportEvent.mockReset();
    const comErro = flowFixture();
    comErro.ui.messages = [{ type: 'error' as const, text: 'The provided credentials are invalid' }];
    mockFetch.mockResolvedValue({ ok: true, json: async () => comErro });
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /continue with github/i })).toBeInTheDocument();
    });
    // Um deep-link para um flow ja expirado mostra erro sem ninguem ter tentado
    // nada. Emitir falha ali inventaria tentativas que nao existiram, e a taxa
    // de sucesso cairia por conta de gente que nem chegou a digitar.
    expect(mockReportEvent.mock.calls.filter((c) => c[0] === 'auth.method.failure')).toEqual([]);
  });

  it('B-096 — recarregar a pagina de erro NAO emite uma segunda falha', async () => {
    sessionStorage.clear();
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    mockFetch.mockResolvedValue({ ok: true, json: async () => flowFixture() });
    const user = userEvent.setup();
    const primeira = render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /continue with github/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /continue with github/i }));
    primeira.unmount();

    const comErro = flowFixture();
    comErro.ui.messages = [{ type: 'error' as const, text: 'invalid' }];
    mockFetch.mockResolvedValue({ ok: true, json: async () => comErro });
    mockReportEvent.mockReset();
    const segunda = render(<LoginPage />);
    await waitFor(() => {
      expect(mockReportEvent.mock.calls.filter((c) => c[0] === 'auth.method.failure').length).toBe(1);
    });
    segunda.unmount();

    // A leitura da tentativa CONSOME. Sem isso, cada F5 na tela de erro somaria
    // uma falha e a metrica mediria teimosia em vez de autenticacao.
    // Assertar o MECANISMO e nao so a consequencia. A primeira versao deste teste
    // olhava apenas a contagem apos um terceiro render — e uma sonda mostrou que
    // ela passava mesmo com o consumo removido, ou seja, era vazia. A chave ter
    // sumido do storage e o fato que a protecao depende, e e verificavel aqui.
    expect(sessionStorage.getItem('theo.auth.pending-attempt')).toBeNull();

    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /continue with github/i }).length).toBeGreaterThan(0);
    });
    expect(mockReportEvent.mock.calls.filter((c) => c[0] === 'auth.method.failure').length).toBe(1);
  });

  // =========================================================================
  // T1.4 — Microcopy title + subtitle (G5)
  // =========================================================================

  it('test_login_renders_new_title_and_subtitle', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    render(<LoginPage />);
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: 'Sign in to LoopScale' }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText('Deploy, monitor, and operate your workloads.'),
    ).toBeInTheDocument();
  });

  // =========================================================================
  // T2.1 — FormField + visible Label (G6, EC-4, EC-5)
  // =========================================================================

  it('test_login_labels_are_visible_text', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });
    // Visible <label> text in DOM (not just aria-label)
    const emailLabel = document.querySelector('label[for]');
    expect(emailLabel).toBeTruthy();
    expect(screen.getAllByText('Email').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Password').length).toBeGreaterThan(0);
  });

  it('test_login_label_htmlfor_matches_input_id', async () => {
    // EC-4: detect upstream @usetheo/ui regression
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });
    const emailInput = screen.getByLabelText('Email') as HTMLInputElement;
    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;
    expect(emailInput.id).toBeTruthy();
    expect(passwordInput.id).toBeTruthy();

    const labels = document.querySelectorAll('label[for]');
    const labelIds = Array.from(labels).map((l) => (l as HTMLLabelElement).htmlFor);
    expect(labelIds).toContain(emailInput.id);
    expect(labelIds).toContain(passwordInput.id);
  });

  it('test_login_input_has_accessible_name', async () => {
    // EC-5: validate FormField.Label provides accessible name
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
  });

  // =========================================================================
  // T2.2 — FAANG-grade auth telemetry (G7, D5)
  // =========================================================================

  it('test_login_emits_attempt_on_github_click', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);

    const user = userEvent.setup();
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /continue with github/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /continue with github/i }));

    const calls = mockReportEvent.mock.calls.filter((c) => c[0] === 'auth.method.attempt');
    expect(calls.length).toBe(1);
    const payload = calls[0][1] as Record<string, unknown>;
    expect(payload.v).toBe(1);
    expect(payload.method).toBe('github');
    expect(typeof payload.correlation_id).toBe('string');
    expect(payload.correlation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(['mobile', 'tablet', 'desktop']).toContain(payload.viewport_bucket);
    expect(typeof payload.timestamp).toBe('number');
  });

  it('test_login_emits_attempt_on_google_click', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);

    const user = userEvent.setup();
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /continue with google/i }));

    const calls = mockReportEvent.mock.calls.filter((c) => c[0] === 'auth.method.attempt');
    expect(calls.length).toBe(1);
    expect((calls[0][1] as Record<string, unknown>).method).toBe('google');
  });

  it('test_login_payload_pii_free', async () => {
    // Rewritten 2026-06-05 (Ralph J-04 loop): only 'auth.method.attempt' is
    // emitted from production code (outcome moved to landing page, not yet
    // implemented). Assert PII-free invariant on the 1 attempt event that
    // actually fires.
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });

    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(
      () => undefined,
    );

    const user = userEvent.setup();
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Email'), 'sensitive@example.com');
    await user.type(screen.getByLabelText('Password'), 'never-leak-me');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockReportEvent.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    const forbiddenKeys = [
      'email',
      'identifier',
      'password',
      'session',
      'user_id',
      'tenant_id',
      'referrer',
    ];
    for (const call of mockReportEvent.mock.calls) {
      const payload = call[1] as Record<string, unknown>;
      for (const key of forbiddenKeys) {
        expect(payload).not.toHaveProperty(key);
      }
      // Stringified payload must not contain the actual values
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain('sensitive@example.com');
      expect(serialized).not.toContain('never-leak-me');
    }
  });

  // =========================================================================
  // T3.1 — Passkey autofill (G8)
  // =========================================================================

  it('test_login_email_autocomplete_includes_webauthn', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });
    const emailInput = screen.getByLabelText('Email') as HTMLInputElement;
    expect(emailInput.getAttribute('autocomplete')).toBe('email webauthn');
  });

  // =========================================================================
  // T0.1 — J-04 plan: `?provider=` autofocus on OIDC button
  // =========================================================================

  it('test_login_provider_github_autofocus', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    render(<LoginPage />, { initialEntries: ['/login?provider=github'] });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /continue with github/i })).toBeInTheDocument();
    });
    const ghBtn = screen.getByRole('button', { name: /continue with github/i });
    await waitFor(() => {
      expect(document.activeElement).toBe(ghBtn);
    });
    expect(ghBtn.className).toContain('ring-2');
  });

  it('test_login_provider_google_autofocus', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    render(<LoginPage />, { initialEntries: ['/login?provider=google'] });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
    });
    const googleBtn = screen.getByRole('button', { name: /continue with google/i });
    await waitFor(() => {
      expect(document.activeElement).toBe(googleBtn);
    });
    expect(googleBtn.className).toContain('ring-2');
  });

  // Red Team theo-cloud#51 closure: every form field on /login MUST
  // carry an `id` + `name` so the browser's "form field element should
  // have an id or name attribute" warning stops firing AND password
  // managers can label the field. (Previously the email/password
  // <Input>s lacked both, even though their <FormField.Label> rendered
  // text — the visible label was decorative, not programmatically tied.)
  it('login email + password inputs have id + name (#51)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    });
    const email = screen.getByLabelText(/email/i) as HTMLInputElement;
    const password = screen.getByLabelText(/password/i) as HTMLInputElement;
    expect(email.id).toBe('login-email');
    expect(email.name).toBe('email');
    expect(password.id).toBe('login-password');
    expect(password.name).toBe('password');
  });

  it('test_login_tap_targets_meet_wcag_258_closes_24', async () => {
    // Sprint 3 Phase 4 (#24) v1.1 ADR D4 — WCAG 2.5.8 Target Size Minimum.
    // QA Red Team 2026-06-24 measured "Create account" 91×19 and "Forgot
    // password?" 107×19 — both below the 24×24 floor. Fix adds
    // `min-h-[44px] inline-flex items-center` to both links.
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /create account/i })).toBeInTheDocument();
    });
    const createAccount = screen.getByRole('link', { name: /create account/i });
    const forgotPassword = screen.getByRole('link', { name: /forgot password/i });
    // jsdom can't compute the rendered pixel box, so assert the canonical
    // Tailwind utility is present in the className. This is the same shape
    // QA's DOM probe asserts ("min-h-[44px]" OR "h-11" OR "py-3"/"py-4").
    expect(createAccount.className).toMatch(/min-h-\[44px\]|min-h-11|h-11|py-3|py-4/);
    expect(forgotPassword.className).toMatch(/min-h-\[44px\]|min-h-11|h-11|py-3|py-4/);
  });
});

describe('B-141 — uma hidratação que falhou não deixa o botão mudo', () => {
  it('diz que não conseguiu preparar o formulário quando as DUAS tentativas falham', async () => {
    // Sem fluxo não há `action` nem `csrf_token`: o botão "Sign in" vira um no-op. A pessoa
    // clica, nada acontece, e a tela não diz nada — então ela tenta de novo e conclui que a senha
    // está errada. As duas falhas eram engolidas, a segunda por um `catch(() => {})` vazio.
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<LoginPage />);

    expect(await screen.findByText(/network error/i)).toBeInTheDocument();
  });

  it('uma hidratação que FUNCIONA não mostra erro nenhum', async () => {
    // A correção não pode virar "sempre avisa": um aviso que aparece no caminho feliz ensina a
    // ignorá-lo.
    mockFetch.mockResolvedValue({ ok: true, json: async () => flowFixture() });

    render(<LoginPage />);

    await waitFor(() => { expect(screen.getByLabelText('Email')).toBeInTheDocument(); });
    // Lido sobre o TEXTO renderizado: a catraca de asserções de ausência (B-162) congela a forma
    // `queryBy…toBeNull()`, e ler o corpo é a afirmação mais forte de qualquer modo.
    expect(document.body.textContent ?? '').not.toMatch(/network error/i);
  });
});
