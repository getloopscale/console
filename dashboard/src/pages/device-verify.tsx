import { useEffect, useMemo, useState } from 'react';
import { Card, Button } from '@usetheo/ui';
import { isSafeRedirectUrl } from '@/lib/auth/safe-redirect';

// Plan J-05 amendment 2026-06-05 (LIVE debug iter 3) — Hydra v2.6 requires
// the operator to host the device-verify UI: when the browser opens
// `verification_uri` Hydra redirects to whatever `urls.device.verification`
// points at, with `?device_challenge=<X>&user_code=<Y>` in the query.
// This page pre-fills the user_code, lets the user confirm, and POSTs to
// `/v1/auth/device/accept` which calls Hydra admin AcceptDeviceChallenge.
//
// The DASHBOARD never needs the device_code — only device_challenge (opaque
// session token Hydra emits) and user_code (the human-readable code shown
// in the CLI). EC-13 applies: the page never exposes these to console.log,
// telemetry, or URLs after submit.

const ACCEPT_PATH = '/v1/auth/device/accept';

export function DeviceVerifyPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const deviceChallenge = params.get('device_challenge') ?? '';
  const initialUserCode = params.get('user_code') ?? '';

  const [userCode, setUserCode] = useState(initialUserCode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceChallenge) {
      setError(
        'Missing device challenge. Please run `theo login --device-flow` again from your terminal.',
      );
    }
  }, [deviceChallenge]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!deviceChallenge || !userCode.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const resp = await fetch(ACCEPT_PATH, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_challenge: deviceChallenge,
          user_code: userCode.trim(),
        }),
      });
      const body = (await resp.json().catch(() => ({}))) as {
        redirect_to?: string;
        message?: string;
      };
      if (!resp.ok || !body.redirect_to) {
        setError(
          body.message ??
            'Could not authorize this device. Double-check the code or run `theo login --device-flow` again.',
        );
        setSubmitting(false);
        return;
      }
      // B-031 — valida o destino ANTES de navegar (OWASP A01).
      //
      // Este era um open-redirect: a URL vinha de uma resposta do servidor e ia
      // direto para `window.location.href`, sem checagem. O guard que fecha
      // exatamente esta classe — `isSafeRedirectUrl` — existia no repo,
      // documentado como "defense-in-depth para redirect_browser_to", testado, e
      // sem NENHUM chamador. Um guard de seguranca nao chamado e pior que
      // ausente: da a impressao de que a protecao existe.
      //
      // Fail-closed de proposito. Se o destino nao estiver na allowlist, o
      // usuario ve um erro em vez de ser levado para fora — o caminho legitimo
      // (auth-dev/auth.usetheo.dev, os hosts do fluxo OAuth) esta coberto.
      if (!isSafeRedirectUrl(body.redirect_to)) {
        setError(
          'The authentication service returned an unexpected redirect target. ' +
            'For your safety we did not follow it — run `theo login --device-flow` again.',
        );
        setSubmitting(false);
        return;
      }
      window.location.href = body.redirect_to;
    } catch {
      setError(
        'We could not reach the authentication service. Please try again in a moment.',
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <Card.Body className="p-8 space-y-5">
          <div className="space-y-1">
            <h1 className="font-display text-title-sm font-semibold text-foreground">
              Authorize your CLI
            </h1>
            <p className="text-body-sm text-muted-foreground">
              Confirm the code shown in your terminal to finish signing in.
            </p>
          </div>

          <form
            onSubmit={onSubmit}
            className="space-y-4"
            data-testid="device-verify-form"
            aria-label="Device verify form"
          >
            <label className="block text-body-xs font-medium text-foreground" htmlFor="user-code">
              Code from your terminal
            </label>
            <input
              id="user-code"
              name="user_code"
              type="text"
              autoComplete="off"
              autoFocus
              required
              value={userCode}
              onChange={(e) => setUserCode(e.target.value.toUpperCase())}
              data-testid="device-verify-user-code"
              className="w-full rounded border border-border bg-background px-3 py-2 font-mono text-title-xs tracking-widest text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />

            {error && (
              <p
                role="alert"
                data-testid="device-verify-error"
                className="text-body-xs text-destructive"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              data-testid="device-verify-submit"
              disabled={!deviceChallenge || !userCode.trim() || submitting}
              className="w-full"
            >
              {submitting ? 'Authorizing…' : 'Authorize'}
            </Button>
          </form>

          <p className="text-body-xs text-muted-foreground">
            If you did not start this from your terminal, you can safely close this tab.
          </p>
        </Card.Body>
      </Card>
    </div>
  );
}

export { ACCEPT_PATH };
