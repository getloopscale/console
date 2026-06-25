import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Github, Loader2, Mail, Zap } from 'lucide-react';
import { Alert, Button, Card, Input } from '@usetheo/ui';
import { GoogleBrandIcon } from '@/components/google-brand-icon';
import { useSetPageTitle } from '@/hooks/use-page-meta';
import { getSession } from '@/lib/auth';
import { API_URL, AUTH_URL } from '@/lib/config';
// T1.2/T1.3 of plan qa-sprint1-cleanup-2026-06-24 v1.2 — closes #18 + #28.
import { KRATOS_PASSWORD_MIN_LENGTH } from '@/lib/auth-policy';
import { validateRequired, validateEmail, validatePasswordMinLength } from '@/lib/validation';

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

export function RegisterPage() {
  useSetPageTitle('Sign up');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // `registered` was set by the deprecated XHR submit path which received
  // data.session inline. The new form.submit() path navigates immediately
  // on success, so the "registered" intermediate UI block is unreachable.
  // Kept the state read for backward-compat with the success card render
  // (line ~138); setter no longer fires.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [registered, _setRegistered] = useState(false);

  // T1.3 of plan qa-sprint1-cleanup-2026-06-24 v1.2 — client-side validation errors
  // surfaced from app-controlled (NOT native browser) validation pipeline.
  // Keyed by field name. Empty record = no errors.
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    getSession().then((s) => {
      if (s) navigate('/', { replace: true });
      else setLoading(false);
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
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = flow.ui.action;
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
      document.body.appendChild(form);
      form.submit();
      return;
    } catch {
      /* network error */
    } finally {
      // submitting state remains true until the navigation lands on a new
      // page (success → /, failure → /register?flow=X re-rendered).
      // We don't clear it here because form.submit() doesn't return synchronously.
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="size-6 text-primary animate-spin" aria-label="Loading" />
      </div>
    );
  }

  if (registered) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <Card.Body className="p-8 text-center space-y-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 mx-auto">
              <Mail className="size-6 text-primary" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h1 className="font-display text-title-sm font-semibold text-foreground">
                Check your email
              </h1>
              <p className="text-body-sm text-muted-foreground">
                We sent a verification code to{' '}
                <span className="text-foreground font-medium">{email}</span>.
              </p>
              <p className="text-label text-muted-foreground">
                Redirecting to dashboard...
              </p>
            </div>
            <Loader2 className="size-4 text-primary animate-spin mx-auto" aria-hidden="true" />
          </Card.Body>
        </Card>
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
                size="lg"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                autoComplete="name"
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
            <Link to="/login" className="text-primary hover:text-primary/80">
              Sign in
            </Link>
          </p>
        </Card.Body>
      </Card>
    </div>
  );
}
