import { useState } from 'react';
import { formatDeployError, ROLLBACK } from '@/pages/deploy/components/deploy-error-copy';
import { Undo2 } from 'lucide-react';
import {
  Button,
  Checkbox,
  Input,
  Label,
  useToast,
} from '@usetheo/ui';
import { AppModal } from '@/components/ui/app-modal';
import { Alert } from '@/components/ui/alert-guard';
import { ApiError } from '@/lib/http/api';
import { useRollback } from '@/hooks/mutations/use-rollback';
import { useStartRollback, useEndRollback } from '@/hooks/deploy/use-rollback-in-flight';
import { ROLLBACK_DEADLINE_MS, type RollbackOutcome } from '@/hooks/deploy/rollback-outcome';
import type { Build, RollbackResponse } from '@/lib/api/types';

interface RollbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  targetBuild: Build;
  /** Called when the rollback ended, whichever way, with the API's 202 body. */
  onRolledBack?: (response: RollbackResponse) => void;
}

const CONFIRMATION_PHRASE = 'rollback production';

export function RollbackDialog({
  open,
  onOpenChange,
  projectName,
  targetBuild,
  onRolledBack,
}: RollbackDialogProps) {
  const rollback = useRollback();
  const [phrase, setPhrase] = useState('');
  // M18: non-production rollback still needs an explicit acknowledgement (a
  // single deliberate step) so a stray click on the grid can't silently revert
  // staging/preview. Production keeps the stricter type-to-confirm phrase.
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast, dismiss } = useToast();
  const startRollback = useStartRollback();
  const endRollback = useEndRollback();

  const isProd = targetBuild.environment === 'production';
  const requiresPhrase = isProd;
  const sha = targetBuild.commit_sha.slice(0, 7);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (requiresPhrase && phrase !== CONFIRMATION_PHRASE) {
      setError(`Type "${CONFIRMATION_PHRASE}" exactly to confirm.`);
      return;
    }

    // The dialog closes on a valid submit so the page is not locked while the
    // rollback runs, which the API allows up to 15 minutes. Progress and result
    // are global toasts: info now, success or destructive when it ended.
    const progressId = toast({
      title: `Rollback in progress`,
      description: `Reverting ${projectName} (${targetBuild.environment}) to ${sha}…`,
      variant: 'info',
      duration: null, // sticky until the rollback ended
    });
    setPhrase('');
    onOpenChange(false);

    // Publish the in-flight state so the deployments grid and the build header
    // show the pulsing "Rolling back to <sha>..." badge on the target row. It is
    // cleared on every exit path, before the matching toast.
    startRollback({
      projectName,
      targetBuildId: targetBuild.build_id,
      targetSha: sha,
      startedAt: Date.now(),
    });

    try {
      // `useRollback` owns the call. It resolves when the rollback ENDED, not on
      // the API's 202: the 202 only says the rollback was accepted.
      const outcome = await rollback.mutateAsync({
        projectName,
        environment: targetBuild.environment ?? '',
        buildId: targetBuild.build_id,
      });
      dismiss(progressId);
      // Clear in-flight BEFORE onRolledBack so the refetch in the parent renders
      // the real badge in the same frame the pulsing one disappears.
      endRollback(projectName);
      if (!outcome) {
        toast({
          title: 'Rollback failed',
          description: 'Session expired. Sign in again and retry the rollback.',
          variant: 'destructive',
        });
        return;
      }
      onRolledBack?.(outcome.accepted);
      toast(outcomeToast(outcome, { projectName, environment: targetBuild.environment ?? '', sha }));
    } catch (e) {
      endRollback(projectName);
      dismiss(progressId);
      // The API refused the POST, or it never arrived. `formatRollbackError`
      // owns the message per status, read from the `ApiError` that
      // `throwOnError` raises. A network failure is not an ApiError and gets
      // the generic text: "the backend refused" and "your connection dropped"
      // ask for different actions.
      const apiErr = e instanceof ApiError ? e : null;
      toast({
        title: 'Rollback failed',
        description: apiErr
          ? formatRollbackError(apiErr.status, apiErr.body as { message?: string; code?: string; error?: string } | null)
          : e instanceof Error
            ? `${e.message}. The current release remains active. Check connection and retry.`
            : 'Network error. The current release remains active. Check connection and retry.',
        variant: 'destructive',
        duration: null,
      });
    }
  };

  return (
    <AppModal
      open={open}
      onClose={() => onOpenChange(false)}
      title={<span className="inline-flex items-center gap-2"><Undo2 className="size-5 text-warning" aria-hidden="true" />Rollback to {sha}</span>}
      description={<>This will replace the current release in <span className="font-mono">{targetBuild.environment}</span> with the build from commit <span className="font-mono">{sha}</span>.</>}
      footer={<><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button><Button
              type="submit" form="rollback-form"
              variant="destructive"
              disabled={(requiresPhrase && phrase !== CONFIRMATION_PHRASE) || (!isProd && !ack)}
            >
              Rollback to {sha}
            </Button></>}
    >
      <form id="rollback-form" onSubmit={handleSubmit} className="space-y-4">
          <Alert
            intent="warning"
            description={`The rollback runs in the background and can take several minutes. Existing connections drain gracefully.`}
          />

          {requiresPhrase && (
            <div>
              <Label htmlFor="rollback-phrase">
                Type <span className="font-mono">{CONFIRMATION_PHRASE}</span> to confirm
              </Label>
              <Input
                id="rollback-phrase"
                type="text"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                autoFocus
                required
              />
            </div>
          )}

          {!isProd && (
            <label className="flex items-start gap-2 text-body-sm">
              <Checkbox checked={ack} onCheckedChange={(c) => setAck(c === true)} aria-label="Confirm rollback" />
              <span>
                Yes, replace the current release in{' '}
                <span className="font-mono">{targetBuild.environment}</span> with commit{' '}
                <span className="font-mono">{sha}</span>.
              </span>
            </label>
          )}

          {error && <Alert intent="destructive" description={error} />}

          
        </form>
    </AppModal>
  );
}

type ToastInput = Parameters<ReturnType<typeof useToast>['toast']>[0];

/**
 * The toast for a rollback that ended, by how it ended. Only `succeeded` says
 * the target is serving; the other three say which release is active, or that
 * the console could not find out.
 */
function outcomeToast(
  outcome: RollbackOutcome,
  ctx: { projectName: string; environment: string; sha: string },
): ToastInput {
  const { accepted, activeReleaseId } = outcome;
  const where = `${ctx.projectName} (${ctx.environment})`;
  switch (outcome.state) {
    case 'succeeded':
      return {
        title: `Rolled back to ${ctx.sha}`,
        description: `${where} is serving release ${accepted.reactivated_release}.`,
        variant: 'success',
      };
    case 'failed':
      return {
        title: 'Rollback failed',
        description: `The rollback to ${ctx.sha} did not complete. Release ${accepted.rolled_back_release} stays active in ${where}.`,
        variant: 'destructive',
        duration: null,
      };
    case 'superseded':
      return {
        title: 'Rollback failed',
        description: `The rollback to ${ctx.sha} did not complete: release ${activeReleaseId} became active in ${where} while it ran.`,
        variant: 'destructive',
        duration: null,
      };
    case 'timed_out':
      return {
        title: 'Rollback not confirmed',
        description: `${where} showed no active release after ${ROLLBACK_DEADLINE_MS / 60_000} minutes${outcome.lastReadError ? ` (${outcome.lastReadError.message})` : ''}. Check Deployments for the release that is serving.`,
        variant: 'destructive',
        duration: null,
      };
  }
}

/**
 * Translate a canonical LoopScaleError body into actionable user-facing copy.
 * Uses product-language only (no internal terms per Cross-Project Rule 9):
 * we say "deployment infrastructure", never "ArgoCD" or "Kubernetes".
 */
function formatRollbackError(
  status: number,
  body: { message?: string; code?: string; error?: string } | null,
): string {
  return formatDeployError(ROLLBACK, status, body);
}
