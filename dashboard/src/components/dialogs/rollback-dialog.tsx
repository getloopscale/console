import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import {
  Button,
  Checkbox,
  Input,
  Label,
  useToast,
} from '@usetheo/ui';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/alert-guard';
import { cloudFetchRaw } from '@/lib/http/api';
import { useStartRollback, useEndRollback } from '@/hooks/use-rollback-in-flight';
import type { Build, RollbackResponse } from '@/lib/api/types';

interface RollbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  targetBuild: Build;
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

    // LIVE-caught 2026-06-18 sponsor feedback: close the dialog
    // immediately on valid submit so the page doesn't lock up while
    // the rollback (1-3min) runs. Surface progress + result via
    // global toasts — info on submit, success/destructive on settle.
    const progressId = toast({
      title: `Rollback in progress`,
      description: `Reverting ${projectName} (${targetBuild.environment}) to ${sha}…`,
      variant: 'info',
      duration: null, // sticky until we dismiss on settle
    });
    setPhrase('');
    onOpenChange(false);

    // Publish in-flight state so the deployments grid + any other view
    // can render the pulsing "Rolling back to <sha>..." badge on the
    // target row during the ~90s sync window. Cleared in every exit path
    // (success, 4xx/5xx, network, token expired) before the matching
    // toast fires, so the badge never lingers past the result.
    startRollback({
      projectName,
      targetBuildId: targetBuild.build_id,
      targetSha: sha,
      startedAt: Date.now(),
    });

    try {
      // B-013 — passa por cloudFetchRaw em vez de window.fetch cru.
      //
      // O caminho anterior pegava o JWT via ensureSSEToken() — o helper do
      // EventSource — e montava o fetch a mao. Isso saía do pipeline de auth do
      // client: sem retry-apos-refresh no 401 e sem o interceptor de 402 (limite
      // de plano). Num POST que promove ou reverte producao, perder o refresh
      // significa que uma sessao renovavel vira "Session expired" na cara do
      // operador no pior momento possivel.
      //
      // cloudFetchRaw devolve a Response, entao o tratamento de erro por status
      // + corpo abaixo continua identico — o que muda e quem obtem o token.
      const resp = await cloudFetchRaw(
        `/engine/api/v1/projects/${encodeURIComponent(projectName)}/rollback`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            environment: targetBuild.environment,
            build_id: targetBuild.build_id,
          }),
          credentials: 'include',
        },
      );
      if (!resp) {
        endRollback(projectName);
        dismiss(progressId);
        toast({
          title: 'Rollback failed',
          description: 'Session expired. Sign in again and retry the rollback.',
          variant: 'destructive',
        });
        return;
      }
      dismiss(progressId);
      if (!resp.ok) {
        endRollback(projectName);
        const errBody = await resp.json().catch(() => null) as
          | { message?: string; code?: string; error?: string }
          | null;
        toast({
          title: 'Rollback failed',
          description: formatRollbackError(resp.status, errBody),
          variant: 'destructive',
          duration: null, // user must dismiss critical errors
        });
        return;
      }
      const res = (await resp.json()) as RollbackResponse;
      // Clear in-flight BEFORE onRolledBack so the grid invalidation +
      // refetch in the parent renders the canonical "● Active" badge in
      // the same frame the pulsing badge disappears (no visual flicker).
      endRollback(projectName);
      onRolledBack?.(res);
      toast({
        title: `Rolled back to ${sha}`,
        description: `${projectName} (${targetBuild.environment}) is serving the previous release.`,
        variant: 'success',
      });
    } catch (e) {
      endRollback(projectName);
      dismiss(progressId);
      toast({
        title: 'Rollback failed',
        description:
          e instanceof Error
            ? `${e.message}. The current release remains active. Check connection and retry.`
            : 'Network error. The current release remains active. Check connection and retry.',
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
            <Undo2 className="size-5 text-warning" aria-hidden="true" />
            Rollback to {sha}
          </Dialog.Title>
          <Dialog.Description>
            This will replace the current release in <span className="font-mono">{targetBuild.environment}</span> with the build from commit <span className="font-mono">{sha}</span>.
          </Dialog.Description>
        </Dialog.Header>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Alert
            intent="warning"
            description={`Traffic will switch within a few seconds. Existing connections drain gracefully.`}
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

          <Dialog.Footer>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={(requiresPhrase && phrase !== CONFIRMATION_PHRASE) || (!isProd && !ack)}
            >
              Rollback to {sha}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog>
  );
}

/**
 * Translate a canonical TheoError body into actionable user-facing copy.
 * Uses product-language only (no internal terms per Cross-Project Rule 9):
 * we say "deployment infrastructure", never "ArgoCD" or "Kubernetes".
 */
function formatRollbackError(
  status: number,
  body: { message?: string; code?: string; error?: string } | null,
): string {
  const code = body?.code ?? '';
  const detail = body?.message ?? body?.error ?? '';

  // Canonical codes mapped to actionable copy.
  if (code === 'NO_ACTIVE_RELEASE' || /no active release/i.test(detail)) {
    return 'No active release to rollback. Deploy something first, then try again.';
  }
  if (code === 'NO_PREVIOUS_RELEASE' || /no previous release/i.test(detail)) {
    return 'No previous release available. This build is the first deploy — nothing to fall back to.';
  }
  if (/sync wait failed/i.test(detail) || /sync timeout/i.test(detail)) {
    return 'Rollback started but the deployment infrastructure did not finish in time. The current release is in a degraded state — please retry in a few seconds. If the issue persists, contact support.';
  }
  if (/sync trigger failed/i.test(detail)) {
    return 'Rollback could not contact the deployment infrastructure. The current release remains active. Retry, or contact support if it persists.';
  }
  if (code === 'MISSING_FIELD' || status === 400) {
    return detail
      ? `Rollback rejected: ${detail}. Refresh the page and retry.`
      : 'Rollback rejected: the request was malformed. Refresh the page and retry.';
  }
  if (status === 401) {
    return 'Session expired. Sign in again and retry the rollback.';
  }
  if (status === 403) {
    return 'You do not have permission to rollback this project.';
  }
  if (status === 404) {
    return 'Project or build not found. The build may have been deleted — refresh the page.';
  }
  if (status >= 500) {
    return detail
      ? `Rollback failed (HTTP ${status}): ${detail}. The current release remains active. Retry, or contact support if it persists.`
      : `Rollback failed (HTTP ${status}). The current release remains active. Retry, or contact support if it persists.`;
  }
  return detail
    ? `Rollback failed (HTTP ${status}): ${detail}`
    : `Rollback failed (HTTP ${status}). Please retry.`;
}
