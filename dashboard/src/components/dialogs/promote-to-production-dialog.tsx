import { useState } from 'react';
import { ArrowUpToLine } from 'lucide-react';
import { Alert, Button, Dialog, Input, Label, useToast } from '@usetheo/ui';
import { ensureSSEToken } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { useStartMutation, useEndMutation } from '@/hooks/use-mutation-in-flight';
import type { Build, PromoteResponse } from '@/lib/api/types';

interface PromoteToProductionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  /**
   * The deploy that the user is promoting. MUST be a preview-env build
   * (its environment string is the source the backend reads). Production
   * deploys should hide the action upstream (the dialog does not gate).
   */
  sourceBuild: Build;
  onPromoted?: (response: PromoteResponse) => void;
}

const CONFIRMATION_PHRASE = 'promote to production';

/**
 * PromoteToProductionDialog — FAANG-level contextual promote.
 *
 * Sponsor LIVE 2026-06-18 deep-dive: the legacy PromoteDialog asked the
 * user to pick from + to via dropdowns, but in the canonical PaaS model
 * (preview + production only — see project_paas_envs_preview_production_
 * only memory) the destination is ALWAYS production and the source is
 * ALWAYS the deploy the user is currently looking at. The dropdowns
 * were tax for zero ergonomic gain AND introduced a race: a fresh deploy
 * could replace the "active release of source env" between the user
 * opening the view and submitting.
 *
 * Mirror of RollbackDialog: same confirmation-phrase symmetry, same
 * sticky-info-toast trail during the ~90s sync window, same in-flight
 * publish so the deployments grid can render a transitional badge on
 * the target row.
 */
export function PromoteToProductionDialog({
  open,
  onOpenChange,
  projectName,
  sourceBuild,
  onPromoted,
}: PromoteToProductionDialogProps) {
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { toast, dismiss } = useToast();
  const startMutation = useStartMutation();
  const endMutation = useEndMutation();

  const sha = sourceBuild.commit_sha.slice(0, 7);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (phrase !== CONFIRMATION_PHRASE) {
      setError(`Type "${CONFIRMATION_PHRASE}" exactly to confirm.`);
      return;
    }

    // Same UX pattern as RollbackDialog 2026-06-18: close the dialog
    // immediately on valid submit so the page doesn't lock up while
    // the promote (~90s sync) runs. Surface progress + result via
    // global toasts — info on submit, success/destructive on settle.
    const progressId = toast({
      title: `Promote in progress`,
      description: `Promoting ${sha} to production for ${projectName}…`,
      variant: 'info',
      duration: null, // sticky until we dismiss on settle
    });
    setPhrase('');
    onOpenChange(false);

    // Publish in-flight state so the deployments grid + any other view
    // can render a pulsing "↑ Promoting <sha> to production…" badge on
    // the target row during the sync window. Cleared in every exit path
    // (success, 4xx/5xx, network, token expired) before the matching
    // toast fires, so the badge never lingers past the result.
    startMutation({
      kind: 'promote',
      projectName,
      targetBuildId: sourceBuild.build_id,
      targetSha: sha,
      startedAt: Date.now(),
    });

    try {
      const token = await ensureSSEToken();
      if (!token) {
        endMutation(projectName);
        dismiss(progressId);
        toast({
          title: 'Promote failed',
          description:
            'Session expired. Sign in again and retry the promote.',
          variant: 'destructive',
        });
        return;
      }
      // Backend contract retained: POST /promote { from, to }. The
      // preview env name is the source (we know the deploy is in a
      // preview env because the caller hides this action for prod
      // deploys); the target is always production.
      const resp = await fetch(
        `${API_URL}/engine/api/v1/projects/${encodeURIComponent(projectName)}/promote`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            from: sourceBuild.environment,
            to: 'production',
          }),
          credentials: 'include',
        },
      );
      dismiss(progressId);
      if (!resp.ok) {
        endMutation(projectName);
        const errBody = (await resp.json().catch(() => null)) as
          | { message?: string; code?: string; error?: string }
          | null;
        toast({
          title: 'Promote failed',
          description: formatPromoteError(resp.status, errBody),
          variant: 'destructive',
          duration: null,
        });
        return;
      }
      const res = (await resp.json()) as PromoteResponse;
      // Clear in-flight BEFORE onPromoted so the grid invalidation +
      // refetch in the parent renders the canonical "● Active" badge
      // in the same frame the pulsing badge disappears (no flicker).
      endMutation(projectName);
      onPromoted?.(res);
      toast({
        title: `Promoted ${sha} to production`,
        description: `${projectName} is now serving ${sha} on production.`,
        variant: 'success',
      });
    } catch (e) {
      endMutation(projectName);
      dismiss(progressId);
      toast({
        title: 'Promote failed',
        description:
          e instanceof Error
            ? `${e.message}. The current production release remains active. Check connection and retry.`
            : 'Network error. The current production release remains active. Check connection and retry.',
        variant: 'destructive',
        duration: null,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title className="inline-flex items-center gap-2">
            <ArrowUpToLine className="size-5 text-primary" aria-hidden="true" />
            Promote {sha} to production
          </Dialog.Title>
          <Dialog.Description>
            This will make <span className="font-mono">{sha}</span> the
            production deploy of{' '}
            <span className="font-mono">{projectName}</span>. Visitors will see
            this version. The current production release becomes the previous
            release — one click to revert.
          </Dialog.Description>
        </Dialog.Header>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Alert
            intent="warning"
            description="Traffic switches within a few seconds. Existing connections drain gracefully."
          />

          <div>
            <Label htmlFor="promote-phrase">
              Type <span className="font-mono">{CONFIRMATION_PHRASE}</span> to
              confirm
            </Label>
            <Input
              id="promote-phrase"
              type="text"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              autoFocus
              required
            />
          </div>

          {error && <Alert intent="destructive" description={error} />}

          <Dialog.Footer>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={phrase !== CONFIRMATION_PHRASE}
            >
              Promote {sha} to production
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog>
  );
}

/**
 * Translate a canonical TheoError body into actionable user-facing
 * copy. Mirrors formatRollbackError — same product-language only
 * policy (Cross-Project Rule 9): we say "deployment infrastructure",
 * never "ArgoCD" or "Kubernetes".
 */
export function formatPromoteError(
  status: number,
  body: { message?: string; code?: string; error?: string } | null,
): string {
  const code = body?.code ?? '';
  const detail = body?.message ?? body?.error ?? '';

  if (code === 'NO_ACTIVE_RELEASE' || /no active release/i.test(detail)) {
    return 'No active release in the source environment yet. Wait for the build to finish and retry.';
  }
  if (code === 'SAME_ENVIRONMENT' || /same environment/i.test(detail)) {
    return 'This deploy is already on production. Pick a preview deploy to promote.';
  }
  if (/sync wait failed/i.test(detail) || /sync timeout/i.test(detail)) {
    return 'Promote started but the deployment infrastructure did not finish in time. The current production release remains active — please retry in a few seconds. If the issue persists, contact support.';
  }
  if (/sync trigger failed/i.test(detail)) {
    return 'Promote could not contact the deployment infrastructure. The current production release remains active. Retry, or contact support if it persists.';
  }
  if (code === 'MISSING_FIELD' || status === 400) {
    return detail
      ? `Promote rejected: ${detail}. Refresh the page and retry.`
      : 'Promote rejected: the request was malformed. Refresh the page and retry.';
  }
  if (status === 401) {
    return 'Session expired. Sign in again and retry the promote.';
  }
  if (status === 403) {
    return 'You do not have permission to promote in this project.';
  }
  if (status === 404) {
    return 'Project or build not found. Refresh the page.';
  }
  if (status === 409) {
    return 'Another deploy is already in progress on production. Wait for it to finish and retry.';
  }
  if (status >= 500) {
    return detail
      ? `Promote failed (HTTP ${status}): ${detail}. The current production release remains active. Retry, or contact support if it persists.`
      : `Promote failed (HTTP ${status}). The current production release remains active. Retry, or contact support if it persists.`;
  }
  return detail
    ? `Promote failed (HTTP ${status}): ${detail}`
    : `Promote failed (HTTP ${status}). Please retry.`;
}
