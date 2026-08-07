import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Github, Loader2, Zap } from 'lucide-react';
import { Button, Card, Input } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import { GoogleBrandIcon } from '@/components/google-brand-icon';
import { useSetPageTitle } from '@/hooks/use-page-meta';
import { getSession } from '@/lib/auth/session';
import { API_URL, AUTH_URL } from '@/lib/http/config';
// T1.2/T1.3 of plan qa-sprint1-cleanup-2026-06-24 v1.2 — closes #18 + #28.
import { KRATOS_PASSWORD_MIN_LENGTH } from '@/pages/auth/auth-policy';
import { validateRequired, validateEmail, validatePasswordMinLength, validateMaxLength } from '@/pages/auth/validation';
import { RegisterCompletingScreen } from '@/components/register/register-completing-screen';

const KRATOS_URL = AUTH_URL || API_URL;

interface FlowNode {
  group: string;
  attributes: { name?: string; type?: string; value?: string };
  messages?: { text: string; type: string }[];
}

interface Flow {
  id: string;
  ui: {
    action: string;
    method: string;
    nodes: FlowNode[];
    messages?: { text: string; type: string }[];
  };
}

// Red Team theo-cloud#74 closure: the form POST navigates the page so
// React state is wiped on re-render. The user lands back here with empty
// inputs after a benign "account exists" error and is forced to retype
// everything (especially a long password). Persist non-secret fields
// across the navigation via sessionStorage so the user only has to fix
// what was wrong. Password is NOT persisted (security) — the canonical
// 2026 UX pattern (Vercel, Linear, Stripe) is "preserve name + email,
// re-ask for password".
const REGISTER_FORM_RESTORE_KEY = 'theo-register-form-restore';

function readPersistedRegisterForm(): { name?: string; email?: string } | null {
  try {
    const raw = sessionStorage.getItem(REGISTER_FORM_RESTORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { name?: string; email?: string };
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function persistRegisterForm(name: string, email: string): void {
  try {
    sessionStorage.setItem(
      REGISTER_FORM_RESTORE_KEY,
      JSON.stringify({ name, email }),
    );
  } catch {
    // sessionStorage may be unavailable (private browsing on some
    // browsers); preserve-on-error is a UX win, not a hard guarantee.
  }
}

function clearPersistedRegisterForm(): void {
  try {
    sessionStorage.removeItem(REGISTER_FORM_RESTORE_KEY);
  } catch {
    /* ignore */
  }
}

export function RegisterPage() {
  useSetPageTitle('Sign up');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [loading, setLoading] = useState(true);
  // M0 J-02 T3.1 — once a session is detected (registration succeeded), show the
  // provisioning "completing" screen until the tenant bootstrap is ready, then
  // redirect. An already-provisioned session resolves instantly (no delay).
  const [completing, setCompleting] = useState(false);
  // #74 closure: hydrate name/email from the prior submission when the
  // Kratos POST round-tripped here with an error. The persisted blob is
  // cleared as soon as the user lands on /auth/check-email after a
  // successful signup (see the useEffect below).
  const [name, setName] = useState<string>(() => readPersistedRegisterForm()?.name ?? '');
  const [email, setEmail] = useState<string>(() => readPersistedRegisterForm()?.email ?? '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // T1.3 of plan qa-sprint1-cleanup-2026-06-24 v1.2 — client-side validation errors
  // surfaced from app-controlled (NOT native browser) validation pipeline.
  // Keyed by field name. Empty record = no errors.
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    getSession().then((s) => {
      if (s) {
        // #74 closure: a session means the prior submission succeeded;
        // wipe the persisted form so a future signup attempt (after
        // logout) starts clean.
        clearPersistedRegisterForm();
        // Hand off to the provisioning "completing" screen instead of
        // redirecting immediately, so a brand-new tenant lands on the app only
        // after its bootstrap is ready (M0 J-02 T3.1).
        setCompleting(true);
      } else {
        setLoading(false);
      }
    });
  }, [navigate]);

  useEffect(() => {
    const flowId = searchParams.get('flow');
    if (flowId) {
      fetch(`${KRATOS_URL}/self-service/registration/flows?id=${flowId}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((f) => f && setFlow(f))
        .catch(() => {});
    } else if (!loading) {
      fetch(`${KRATOS_URL}/self-service/registration/browser`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        redirect: 'follow',
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((f) => f?.ui && setFlow(f))
        .catch(() => {});
    }
  }, [searchParams, loading]);

  const submitOIDC = (provider: string) => {
    if (!flow) return;
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = flow.ui.action;
    const csrfNode = flow.ui.nodes.find((n) => n.attributes.name === 'csrf_token');
    for (const [k, v] of [
      ['csrf_token', csrfNode?.attributes.value || ''],
      ['method', 'oidc'],
      ['provider', provider],
    ]) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = k;
      input.value = v;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  };

  // SECURITY: submit password registration via top-level HTML form POST
  // instead of XHR fetch. Top-level navigation sends SameSite=Lax cookies
  // (including the anti-CSRF cookie Kratos requires), whereas cross-origin
  // XHR drops Lax cookies even between same-site subdomains. Same pattern
  // as submitOIDC above. Without this, Kratos returns 403 CSRF violation.
  // Fix 2026-06-01 — "configuração mais segura possível" mandate; avoids
  // weakening to SameSite=None which would expose the flow to cross-site
  // CSRF from third-party sites.
  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!flow) return;

    // T1.3 + EC-1 + EC-2 of plan qa-sprint1-cleanup-2026-06-24 v1.2 — closes
    // #18 + #28. App-controlled validation runs BEFORE form submission so the
    // user sees EN error messages (matching UI lang) instead of native browser
    // popups in their browser locale (pt-BR was the QA repro). The gate also
    // prevents short-password round-trip after `noValidate` disabled HTML
    // minLength enforcement.
    const errors: Record<string, string> = {};
    const nameErr = validateRequired(name, 'Name');
    if (nameErr) errors.name = nameErr;
    // theo-cloud#65 closure: cap Name at 256 chars at the form gate. Mirrors
    // the Kratos identity schema cap (theo/infra/helm/ory-kratos/identity.
    // schema.json → traits.name.maxLength: 256). Without this, a 20 000-char
    // Name bloats the session JWT to ~27 KB (root cause of #64). The HTML
    // maxLength={256} on the <Input> below is a defense-in-depth ceiling
    // (paste cap); this JS gate is the canonical validation that surfaces
    // the error message to the user.
    const nameMaxErr = validateMaxLength(name, 'Name', 256);
    if (nameMaxErr) errors.name = nameMaxErr;
    const emailErr = validateEmail(email);
    if (emailErr) errors.email = emailErr;
    const passwordErr = validatePasswordMinLength(password, KRATOS_PASSWORD_MIN_LENGTH);
    if (passwordErr) errors.password = passwordErr;
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) {
      // Validation failed — do NOT proceed to form.submit(). preventDefault()
      // already called at top; returning here keeps the form unsubmitted.
      return;
    }

    setSubmitting(true);
    const csrfNode = flow.ui.nodes.find((n) => n.attributes.name === 'csrf_token');
    try {
      // T3.4 of plan kratos-self-service-rate-limit-systemic v1.1 — route
      // through the theo-cloud BFF response-shape unifier (closes Red Team
      // theo-cloud#43). The BFF (theo-cloud /v1/auth/register) proxies to
      // the upstream identity-store and returns the canonical universal
      // response identically for both new and existing email branches,
      // so an attacker cannot distinguish account existence by reading
      // the response.
      const form = document.createElement('form');
      form.method = 'POST';
      // The upstream identity-store requires the registration flow id on the
      // submit query (`?flow=<id>`); without it the submit is rejected and the
      // BFF's anti-enumeration unifier maps the rejection to the canonical
      // check-email response — a SILENT no-op that creates no account. Forward
      // the flow id so the proxied submit actually registers the user.
      // Regression: register.test.tsx "BFF submit carries the flow id".
      form.action = `/v1/auth/register?flow=${encodeURIComponent(flow.id)}`;
      for (const [k, v] of [
        ['csrf_token', csrfNode?.attributes.value || ''],
        ['method', 'password'],
        ['traits.email', email],
        ['traits.name', name],
        ['password', password],
      ]) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = k;
        input.value = v;
        form.appendChild(input);
      }
      // #74 closure: persist name + email immediately before the
      // page navigates so the post-error re-render can rehydrate
      // them. Password is intentionally NOT persisted.
      persistRegisterForm(name, email);
      document.body.appendChild(form);
      form.submit();
      return;
    } catch {
      /* network error */
    } finally {
      // submitting state remains true until the navigation lands on a new
      // page (success → /auth/check-email, failure → /register re-rendered).
      // We don't clear it here because form.submit() doesn't return synchronously.
    }
  };

  if (completing) {
    return <RegisterCompletingScreen onReady={() => navigate('/', { replace: true })} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="size-6 text-primary animate-spin" aria-label="Loading" />
      </div>
    );
  }

  const flowErrors = flow?.ui?.messages?.filter((m) => m.type === 'error') ?? [];
  const passwordErrors =
    flow?.ui?.nodes?.find((n) => n.attributes.name === 'password')?.messages?.filter((m) => m.type === 'error') ?? [];
  const emailErrors =
    flow?.ui?.nodes?.find((n) => n.attributes.name === 'traits.email')?.messages?.filter((m) => m.type === 'error') ?? [];
  const allErrors = [...flowErrors, ...passwordErrors, ...emailErrors];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <Card.Body className="p-8 space-y-6">
          <div className="flex items-center gap-2.5">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
              <Zap className="size-5 text-primary" aria-hidden="true" />
            </div>
            <span className="font-display text-title-sm font-bold tracking-tight text-foreground">
              Theo
            </span>
          </div>

          <div className="space-y-1">
            <h1 className="font-display text-title-sm font-semibold text-foreground">
              Create account
            </h1>
            <p className="text-body-sm text-muted-foreground">
              Create your TheoCloud account.
            </p>
          </div>

          {allErrors.length > 0 && (
            <Alert intent="destructive" title={allErrors[0].text} />
          )}

          <div className="space-y-3">
            <Button
              variant="secondary"
              size="lg"
              className="w-full justify-center gap-3"
              onClick={() => submitOIDC('github')}
            >
              <Github className="size-4" aria-hidden="true" />
              Sign up with GitHub
            </Button>
            <Button
              variant="secondary"
              size="lg"
              className="w-full justify-center gap-3"
              onClick={() => submitOIDC('google')}
            >
              <GoogleBrandIcon />
              Sign up with Google
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border/40" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-card px-3 text-label text-muted-foreground">
                or with email
              </span>
            </div>
          </div>

          {/* T1.3 of plan qa-sprint1-cleanup-2026-06-24 v1.2 — closes #28.
            * `noValidate` disables native browser validation (which uses
            * browser locale, NOT page `lang=en`) so all validation messages
            * come from app-controlled `lib/validation.ts` in EN locale.
            * The visible `minLength` + `required` HTML attributes remain as
            * a11y/assistive-tech hints; the submit gate lives in the
            * onSubmit handler (see submitPassword). */}
          <form onSubmit={submitPassword} className="space-y-3" noValidate>
            {/* Sprint 3 Phase 6 (#26) v1.1 ADR D4 — WCAG 3.3.2 Labels or
                Instructions. Replace `placeholder + aria-label` anti-pattern
                with explicit <label htmlFor> + <Input id> (id is forwarded
                through InputHTMLAttributes per the @usetheo/ui InputProps). */}
            <label htmlFor="register-name" className="block text-body-sm font-medium text-foreground">
              Name
              <Input
                id="register-name"
                // Red Team theo-cloud#51 closure: add `name` so the
                // browser-issued "form field element should have an
                // id or name" warning stops firing and password
                // managers can label the field properly.
                name="traits.name"
                size="lg"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                autoComplete="name"
                // theo-cloud#65 closure: HTML maxLength caps typed + pasted
                // input at 256 chars (defense-in-depth). The JS validateMax
                // Length gate above surfaces the user-visible error message
                // when paste-from-clipboard somehow exceeds (older browsers).
                // 256 mirrors the Kratos identity schema cap (theo/infra/
                // helm/ory-kratos/identity.schema.json).
                maxLength={256}
                aria-invalid={validationErrors.name ? true : undefined}
                className="mt-1"
              />
            </label>
            {validationErrors.name && (
              <p role="alert" className="text-body-sm text-destructive -mt-1">{validationErrors.name}</p>
            )}
            <label htmlFor="register-email" className="block text-body-sm font-medium text-foreground">
              Email
              <Input
                id="register-email"
                name="traits.email"
                size="lg"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="Email"
                autoComplete="email"
                aria-invalid={validationErrors.email ? true : undefined}
                className="mt-1"
              />
            </label>
            {validationErrors.email && (
              <p role="alert" className="text-body-sm text-destructive -mt-1">{validationErrors.email}</p>
            )}
            <label htmlFor="register-password" className="block text-body-sm font-medium text-foreground">
              Password
              <Input
                id="register-password"
                name="password"
                size="lg"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={KRATOS_PASSWORD_MIN_LENGTH}
                placeholder={`Password (min. ${KRATOS_PASSWORD_MIN_LENGTH} characters)`}
                autoComplete="new-password"
                aria-invalid={validationErrors.password ? true : undefined}
                className="mt-1"
              />
            </label>
            {validationErrors.password && (
              <p role="alert" className="text-body-sm text-destructive -mt-1">{validationErrors.password}</p>
            )}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full justify-center"
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                'Create account'
              )}
            </Button>
          </form>

          <p className="text-center text-body-sm text-muted-foreground">
            Already have an account?{' '}
            {/* Sprint 3 a11y addendum (#24 symmetry) — same min-h-[44px]
                tap target as login.tsx "Create account" / "Forgot password?". */}
            <Link
              to="/login"
              className="text-primary hover:text-primary/80 min-h-[44px] inline-flex items-center"
            >
              Sign in
            </Link>
          </p>
        </Card.Body>
      </Card>
    </div>
  );
}
