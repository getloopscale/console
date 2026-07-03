import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Card } from '@usetheo/ui';
import { useProvisioningStatus } from '@/hooks/use-provisioning-status';

/**
 * RegisterCompletingScreen — M0 J-02 T3.1.
 *
 * Shown immediately after a successful registration while the new tenant's
 * after-registration bootstrap runs. It polls the provisioning snapshot
 * (useProvisioningStatus → GET /v1/auth/me) and calls `onReady` once the
 * bootstrap is no longer `pending`. An already-provisioned session resolves on
 * the first poll (`active`), so mounting this in the session-success branch is a
 * transparent pass-through for existing users and a proper wait for new ones.
 */
export interface RegisterCompletingScreenProps {
  /** Invoked once provisioning is no longer pending (navigate to the app). */
  onReady: () => void;
}

export function RegisterCompletingScreen({ onReady }: RegisterCompletingScreenProps) {
  const { status, loading } = useProvisioningStatus();

  useEffect(() => {
    // Redirect once provisioning resolves to anything but pending: `active`
    // (ready), or a terminal `unknown` / absent field — all mean "stop waiting,
    // the dashboard can take it from here". Never redirect on the first
    // in-flight poll (loading).
    if (!loading && status !== 'pending') {
      onReady();
    }
  }, [loading, status, onReady]);

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
