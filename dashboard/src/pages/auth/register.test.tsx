import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen, waitFor } from '@/test/render';

vi.mock('@/lib/http/config', () => ({
  API_URL: 'https://auth-dev.getloopscale.com',
  AUTH_URL: '',
  ACCOUNTS_URL: '',
  OAUTH_URL: '',
}));

vi.mock('@/lib/auth/session', () => ({
  getSession: vi.fn().mockResolvedValue(null),
  startLogin: vi.fn(),
}));

vi.mock('@/lib/http/api', () => ({
}));

// M0 J-02 T3.1 — mock the provisioning hook so the completing screen renders
// without a real poll. Default: still pending (stays on the screen).
vi.mock('@/hooks/auth/use-provisioning-status', () => ({
  useProvisioningStatus: vi.fn(() => ({ status: 'pending', loading: false })),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { RegisterPage } from './register';
import { getSession } from '@/lib/auth/session';

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
    id: 'reg-flow-1',
    ui: {
      action: 'https://auth-dev.getloopscale.com/self-service/registration?flow=reg-flow-1',
      method: 'POST',
      nodes: [
        { group: 'default', attributes: { name: 'csrf_token', type: 'hidden', value: 'csrf-reg' } },
        { group: 'password', attributes: { name: 'traits.email', type: 'email' } },
        { group: 'password', attributes: { name: 'password', type: 'password' } },
      ],
      messages: [],
    },
  };
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  // M0 J-02 T3.1 wiring — when a session is detected (registration succeeded),
  // the page hands off to the provisioning "completing" screen instead of
  // redirecting immediately, so a new tenant lands on the app only once its
  // bootstrap is ready.
  it('test_detected_session_shows_provisioning_completing_screen', async () => {
    vi.mocked(getSession).mockResolvedValueOnce({
      identity: { id: 'u1', traits: { email: 'new@x.com', name: 'New User' } },
    } as never);

    render(<RegisterPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /setting up your workspace/i })).toBeInTheDocument();
    });
    // The signup form is NOT shown while completing.
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument();
  });

  it('test_register_renders_form_with_kratos_flow', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    render(<RegisterPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('names the LoopScale product in the header (#521)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    render(<RegisterPage />);
    expect(await screen.findByText('Create your LoopScale account.')).toBeInTheDocument();
    expect(screen.getByText('LoopScale')).toBeInTheDocument();
  });

  it('test_register_oidc_form_submit_preserves_vanilla_dom', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    const createElementSpy = vi.spyOn(document, 'createElement');
    const submitStub = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined);

    const user = userEvent.setup();
    render(<RegisterPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign up with github/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /sign up with github/i }));

    const formCalls = createElementSpy.mock.calls.filter((c) => c[0] === 'form');
    expect(formCalls.length).toBeGreaterThanOrEqual(1);
    expect(submitStub).toHaveBeenCalled();

    createElementSpy.mockRestore();
    submitStub.mockRestore();
  });

  it('test_register_submit_password_posts_traits', async () => {
    // Rewritten 2026-06-05 (Ralph J-04 loop): same root cause as login —
    // submitPassword migrated to form.submit() top-level POST per SameSite-Lax
    // security fix 2026-06-01. Asserts form construction + hidden inputs.
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });

    const createElementSpy = vi.spyOn(document, 'createElement');
    const submitStub = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined);

    const user = userEvent.setup();
    render(<RegisterPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Name'), 'Alice');
    await user.type(screen.getByLabelText('Email'), 'alice@x.com');
    await user.type(screen.getByLabelText('Password'), 'longpassword123');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(submitStub).toHaveBeenCalled();
    });

    const formCalls = createElementSpy.mock.calls.filter((c) => c[0] === 'form');
    expect(formCalls.length).toBeGreaterThanOrEqual(1);

    const forms = Array.from(document.querySelectorAll('form'));
    // T3.4 of plan kratos-self-service-rate-limit-systemic v1.1 — form
    // action now points at the loop-console BFF response-shape unifier
    // (/v1/auth/register) instead of the upstream identity-store directly.
    // BFF returns 303 redirect to /auth/check-email so dashboard navigates
    // uniformly regardless of new-vs-existing email branch (closes Red
    // Team loop-console#43 enumeration).
    const regForm = forms
      .filter((f) => f.action.includes('/v1/auth/register'))
      .find((f) => {
        const methodInput = Array.from(
          f.querySelectorAll('input[type=hidden][name=method]'),
        )[0] as HTMLInputElement | undefined;
        return methodInput?.value === 'password';
      });
    expect(regForm).toBeTruthy();
    if (regForm) {
      // Regression (2026-07-12, dogfood): the BFF submit MUST carry the flow id
      // on the query, else the upstream rejects the submit and the anti-enum
      // unifier silently maps it to check-email with NO account created.
      expect(regForm.action).toContain('flow=reg-flow-1');
      const inputs = Array.from(regForm.querySelectorAll('input[type=hidden]')) as HTMLInputElement[];
      const bag = Object.fromEntries(inputs.map((i) => [i.name, i.value]));
      expect(bag.method).toBe('password');
      expect(bag['traits.email']).toBe('alice@x.com');
      expect(bag['traits.name']).toBe('Alice');
      expect(bag.password).toBe('longpassword123');
      expect(bag.csrf_token).toBe('csrf-reg');
    }

    createElementSpy.mockRestore();
    submitStub.mockRestore();
  });

  it('test_register_displays_kratos_errors', async () => {
    const flowWithError = flowFixture();
    flowWithError.ui.messages = [{ text: 'Email already exists.', type: 'error' }];
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowWithError });
    render(<RegisterPage />);
    await waitFor(() => {
      expect(screen.getByText('Email already exists.')).toBeInTheDocument();
    });
  });

  it('test_register_inputs_have_visible_labels_closes_26', async () => {
    // Sprint 3 Phase 6 (#26) v1.1 ADR D4 — WCAG 3.3.2 Labels or Instructions.
    // Replace `placeholder + aria-label` anti-pattern with explicit
    // <label htmlFor> + <Input id> (id forwards through @getloopscale/ui Input
    // because InputProps extends InputHTMLAttributes per v1.1 EC-5 probe).
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    render(<RegisterPage />);
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /^name$/i })).toBeInTheDocument();
    });
    // Accept either wiring per v1.1 EC-5: htmlFor attribute OR nested-label parent.
    for (const field of ['name', 'email', 'password']) {
      const inputId = `register-${field}`;
      const labelEl =
        document.querySelector(`label[for="${inputId}"]`) ??
        document.getElementById(inputId)?.closest('label');
      expect(labelEl, `<label> for ${field} input`).toBeTruthy();
      expect(labelEl?.className ?? '').not.toMatch(/sr-only/);
      expect(labelEl?.textContent ?? '').toMatch(new RegExp(field, 'i'));
    }
  });

  // loop-console#65 closure (Red Team 2026-06-26): the /register Name field had
  // no length cap (Kratos schema maxLength: -1 + no HTML maxLength), so a
  // 20 000-char Name was accepted, persisted, embedded in the session JWT
  // (root cause of #64 ~27 KB Authorization header → 431). Fix: HTML
  // maxLength=256 on the <Input> + JS validateMaxLength gate + Kratos schema
  // maxLength: 256. This test locks the HTML attribute structurally.
  // Red Team loop-console#74 closure: a benign "account exists" error
  // round-trips through the BFF as a full-page navigation, which wipes
  // React state on re-mount. The fix persists name + email (NOT
  // password) to sessionStorage on submit and re-hydrates them on
  // mount, so the user only has to retype the password.
  it('rehydrates name + email from sessionStorage on mount (#74)', async () => {
    sessionStorage.setItem(
      'loopscale-register-form-restore',
      JSON.stringify({ name: 'Paulo Henrique', email: 'paulo@example.com' }),
    );
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    render(<RegisterPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toBeInTheDocument();
    });
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    const emailInput = screen.getByLabelText('Email') as HTMLInputElement;
    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;
    expect(nameInput.value).toBe('Paulo Henrique');
    expect(emailInput.value).toBe('paulo@example.com');
    // Password MUST stay empty — never persisted.
    expect(passwordInput.value).toBe('');
    sessionStorage.removeItem('loopscale-register-form-restore');
  });

  it('test_register_name_input_has_maxLength_256_closes_65', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => flowFixture() });
    render(<RegisterPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toBeInTheDocument();
    });
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.maxLength).toBe(256);
  });
});
