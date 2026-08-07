import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { Button, Card } from '@usetheo/ui';
import { useSetPageTitle } from '@/hooks/use-page-meta';
import { AUTH_URL, API_URL } from '@/lib/http/config';

// Red Team theo/theo#162 closure (2026-07-01): the post-signup redirect
// target /auth/check-email used to return 404 Caddy raw because the
// Caddyfile handle /auth/* proxied EVERY path to the theo-cloud BFF, and
// the BFF only registered 4 OAuth handlers. The Caddyfile is now narrowed
// to a named @auth_bff matcher (login/login-complete/consent/device) so
// /auth/check-email falls through to the SPA and this page renders.
//
// This is a UI dead-state page: instructive copy + two recovery CTAs
// (Resend verification email via Kratos, Sign in). No form state — the
// underlying verification is a click on the emailed link that lands the
// user on /verification via /auth/verify → Navigate.

const KRATOS_URL = AUTH_URL || API_URL;

export function CheckEmailPage() {
  useSetPageTitle('Check your email');

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="p-3 rounded-full bg-primary/10">
            <Mail className="h-8 w-8 text-primary" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold">Check your email</h1>
          <p className="text-muted-foreground">
            If the email you used is valid, we just sent you a verification link.
            Click it to activate your account.
          </p>
        </div>

        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            The link expires in about an hour. If it does, request a fresh one
            from the sign-in page.
          </p>
          <p>
            Didn&apos;t receive anything after a couple of minutes? Check your
            spam folder, then contact{' '}
            <a
              href="mailto:support@usetheo.dev"
              className="underline hover:text-primary"
            >
              support@usetheo.dev
            </a>
            .
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button asChild variant="secondary">
            <a
              href={`${KRATOS_URL}/self-service/verification/browser`}
              data-testid="check-email-resend"
            >
              Resend verification email
            </a>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/login" data-testid="check-email-signin">
              Back to sign in
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
