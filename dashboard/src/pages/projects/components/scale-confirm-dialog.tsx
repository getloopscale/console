import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';

export interface ScaleConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Project name — drives the canonical type-to-confirm phrase. */
  projectName: string;
  /** Environment that will receive the scale mutation. */
  environment: string;
  /**
   * Current replicas (before save), as the API reported them. `null` when it reported none: the
   * dialog then names only the target and never claims a direction (#552).
   */
  currentReplicas: number | null;
  /** Proposed replicas — for the impact paragraph. */
  proposedReplicas: number;
  /** Server-side monthly cost estimate for the new state. */
  estimatedMonthlyUSD: number;
  /** Signed delta vs current state (positive = increase). */
  deltaUSD: number;
  /** Confirmation handler (mutation). */
  onConfirm: () => void | Promise<void>;
  /** Disable while a mutation is in flight. */
  busy?: boolean;
}

/**
 * ScaleConfirmDialog — J-20 plan v1.1 T3.4.
 *
 * Type-to-confirm gate matching the canonical project-delete convention
 * (EC-8 absorption): the user MUST type `scale <projectname>` before the
 * confirm button enables. The impact paragraph shows the delta in
 * replicas + monthly cost so the consequence is visible BEFORE confirm.
 *
 * Why type-to-confirm for scale?
 *
 * Scale changes hit production cost AND availability immediately:
 *   - Scale up   → bill goes up at next cycle reconcile.
 *   - Scale down → in-flight requests may be terminated.
 *
 * Vercel/Stripe surfaces use type-to-confirm only for destructive flows;
 * Theo extends this to scale because the production blast-radius is
 * equivalent (data loss possible on aggressive down-scale). For Manual →
 * scale-up at the same project size, the dialog still appears but the
 * impact paragraph reads "No change in replicas" (parent guard
 * suppresses for true no-ops).
 */
function directionOf(replicaDelta: number): string {
  if (replicaDelta > 0) return 'increase';
  if (replicaDelta < 0) return 'decrease';
  return 'no change';
}

export function ScaleConfirmDialog({
  open,
  onOpenChange,
  projectName,
  environment,
  currentReplicas,
  proposedReplicas,
  estimatedMonthlyUSD,
  deltaUSD,
  onConfirm,
  busy = false,
}: ScaleConfirmDialogProps) {
  const phrase = `scale ${projectName}`;
  const replicaWord = proposedReplicas === 1 ? 'replica' : 'replicas';
  const change =
    currentReplicas === null
      ? `to ${proposedReplicas} ${replicaWord}.`
      : `${currentReplicas} → ${proposedReplicas} replicas (${directionOf(proposedReplicas - currentReplicas)}).`;
  const costSign = deltaUSD > 0 ? '+' : deltaUSD < 0 ? '–' : '';
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Scale ${projectName}?`}
      description={
        <div className="space-y-2 text-sm">
          <p>
            Apply scale to <strong>{environment}</strong>: {change}
          </p>
          <p>
            Estimated cost: <strong>${estimatedMonthlyUSD.toFixed(2)}/mo</strong>
            {currentReplicas !== null && Math.abs(deltaUSD) > 0.001 && (
              <>
                {' '}({costSign}${Math.abs(deltaUSD).toFixed(2)}/mo vs current)
              </>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Cost is estimated; final bill reconciles to actual usage at the
            end of the billing cycle.
          </p>
        </div>
      }
      intent="destructive"
      confirmationPhrase={phrase}
      confirmLabel={busy ? 'Scaling…' : 'Apply scale'}
      onConfirm={onConfirm}
    />
  );
}
