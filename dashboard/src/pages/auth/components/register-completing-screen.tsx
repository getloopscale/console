import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, Card } from '@getloopscale/ui';
import { useProvisioningStatus } from '@/hooks/auth/use-provisioning-status';

/**
 * RegisterCompletingScreen — M0 J-02 T3.1.
 *
 * Shown immediately after a successful registration while the new tenant's
 * after-registration bootstrap runs. It polls the provisioning snapshot
 * (useProvisioningStatus → GET /v1/auth/me) and calls `onReady` once the
 * bootstrap is no longer `pending`. An already-provisioned session resolves on
 * the first poll (`active`), so mounting this in the session-success branch is a
 * transparent pass-through for existing users and a proper wait for new ones.
 *
 * Bounded wait (EC-1 + EC-2): if provisioning stays `pending` past `maxWaitMs`
 * (the narrow window where the starter-plan lazy INSERT keeps failing), the
 * screen surfaces a "taking longer than expected" warning with a
 * Continue-to-dashboard escape + support contact — never an infinite spinner.
 */
export interface RegisterCompletingScreenProps {
  /** Invoked once provisioning is no longer pending (navigate to the app). */
  onReady: () => void;
  /** After this long still `pending`, show the escape/warning UI. Default 60s. */
  maxWaitMs?: number;
}

export function RegisterCompletingScreen({ onReady, maxWaitMs = 60_000 }: RegisterCompletingScreenProps) {
  const { status, loading } = useProvisioningStatus();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    // Redirect once provisioning resolves to anything but pending: `active`
    // (ready), or a terminal `unknown` / absent field — all mean "stop waiting,
    // the dashboard can take it from here". Never redirect on the first
    // in-flight poll (loading).
    if (!loading && status !== 'pending') {
      onReady();
    }
  }, [loading, status, onReady]);

  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), maxWaitMs);
    return () => clearTimeout(id);
  }, [maxWaitMs]);

  const stillPending = loading || status === 'pending';

  if (timedOut && stillPending) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <Card.Body className="p-8 text-center space-y-4">
            <div className="space-y-1">
              <h1 className="font-display text-title-sm font-semibold text-foreground">
                This is taking longer than expected
              </h1>
              <p className="text-body-sm text-muted-foreground">
                Your workspace is still being set up. You can continue to the
                dashboard — it&rsquo;ll finish in the background. If this keeps
                happening, contact support@getloopscale.com.
              </p>
            </div>
            <Button variant="primary" size="lg" className="w-full justify-center" onClick={onReady}>
              Continue to dashboard
            </Button>
          </Card.Body>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <Card.Body className="p-8 text-center space-y-4">
          <Loader2
            className="size-8 text-primary animate-spin mx-auto"
            aria-label="Setting up your account"
          />
          <div className="space-y-1">
            <h1 className="font-display text-title-sm font-semibold text-foreground">
              Setting up your workspace
            </h1>
            <p className="text-body-sm text-muted-foreground">
              We&rsquo;re provisioning your account — this only takes a moment.
            </p>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
}
