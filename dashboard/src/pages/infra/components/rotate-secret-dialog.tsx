import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Button,
  Input,
  Label,
} from '@getloopscale/ui';
import { AppModal } from '@/components/ui/app-modal';
import { Alert } from '@/components/ui/alert-guard';
import { useRotateSecret } from '@/hooks/mutations/use-secrets-mutations';
import type { ProjectSecret } from '@/hooks/infra/use-secrets';

interface RotateSecretDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secret: ProjectSecret | null;
  /** Optional project param forwarded to the backend. */
  project?: string;
  onRotated?: () => void;
}

/**
 * J-22 T3.3 — RotateSecretDialog (Vercel-canonical destructive pattern).
 *
 * D3 (type-to-confirm): Rotate button is disabled until the user types
 * the EXACT secret name (case-sensitive — EC-19) into the confirm input.
 * Paste is allowed; case-mismatch keeps Rotate disabled (a pasted
 * `database_url` against current `DATABASE_URL` does not unlock).
 *
 * The rotation writes the row's environment and app. The API has no version check on secret
 * writes, so the last write wins. A failure keeps the dialog open with the API's message.
 */
export function RotateSecretDialog({
  open,
  onOpenChange,
  secret,
  project,
  onRotated,
}: RotateSecretDialogProps) {
  const [confirmInput, setConfirmInput] = useState('');
  const [newValue, setNewValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rotateSecret = useRotateSecret();
  const submitting = rotateSecret.isPending;

  const reset = () => {
    setConfirmInput('');
    setNewValue('');
    setError(null);
  };

  // EC-19: exact match, case-sensitive.
  const canRotate = secret !== null && confirmInput === secret.name && newValue.length > 0;

  const handleRotate = async () => {
    if (!canRotate || secret === null) return;
    setError(null);
    try {
      const env =
        (secret.environments && secret.environments[0]) ?? 'production';
      await rotateSecret.mutateAsync({
        name: secret.name,
        newValue,
        environment: env,
        app: secret.app,
        project,
      });
      reset();
      onOpenChange(false);
      onRotated?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Rotate failed: ${err.message}. The secret was NOT changed.`
          : 'Rotate failed. The secret was NOT changed.',
      );
    }
  };

  if (!secret) return null;

  return (
    <AppModal
      open={open}
      onClose={() => onOpenChange(false)}
      title={<>Rotate {secret.name}</>}
      description={<>The current value will be overwritten. Type the secret name to confirm.</>}
      footer={<><Button
            type="button"
            variant="ghost"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
            disabled={submitting}
          >
            Cancel
          </Button><Button type="button" onClick={handleRotate} disabled={!canRotate || submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Rotating…
              </>
            ) : (
              'Rotate'
            )}
          </Button></>}
    >
      <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="rotate-confirm">
              Type <span className="font-mono font-semibold">{secret.name}</span> to confirm
            </Label>
            <Input
              id="rotate-confirm"
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="rotate-new-value">New value</Label>
            <Input
              id="rotate-new-value"
              type="password"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="sk_live_•••"
            />
          </div>

          {error && <Alert intent="destructive" description={error} />}
        </div>
    </AppModal>
  );
}
