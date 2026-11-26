import { useEffect, useMemo, useState } from 'react';
import { Card, Button } from '@getloopscale/ui';
import { safeNavigator } from '@/lib/navigation';

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
        'Missing device challenge. Please run `loopscale login --device-flow` again from your terminal.',
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
            'Could not authorize this device. Double-check the code or run `loopscale login --device-flow` again.',
        );
        setSubmitting(false);
        return;
      }
      // B-031 / B-138 — the destination comes from a server response, so it is judged
      // before it is followed. The check used to live here as an explicit call; it now
      // lives in the navigation boundary, which is the only thing that can reach
      // `window.location`. Fail-closed on purpose: the user sees an error rather than
      // being carried off-site, and the legitimate hosts are allowlisted.
      if (!safeNavigator.goTo(body.redirect_to)) {
        setError(
          'The authentication service returned an unexpected redirect target. ' +
            'For your safety we did not follow it — run `loopscale login --device-flow` again.',
        );
        setSubmitting(false);
        return;
      }
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
