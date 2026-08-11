import { useState } from 'react';
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
      // B-013 — a chamada tem dono: `useRollback`. Um dialogo coleta a
      // confirmacao e mostra o resultado; a rede nao e assunto dele. Enquanto
      // morava aqui, testar o rollback exigia montar um modal e a invalidacao
      // de cache dependia de quem abrisse o dialogo lembrar de faze-la.
      const res = await rollback.mutateAsync({
        projectName,
        environment: targetBuild.environment ?? '',
        buildId: targetBuild.build_id,
      });
      dismiss(progressId);
      if (!res) {
        endRollback(projectName);
        toast({
          title: 'Rollback failed',
          description: 'Session expired. Sign in again and retry the rollback.',
          variant: 'destructive',
        });
        return;
      }
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
      // B-013 — `formatRollbackError` segue dono da mensagem por status; o que
      // mudou e a FONTE. Antes vinha de `resp.status` apos um `if (!resp.ok)`;
      // agora da `ApiError` que o `throwOnError` levanta. Falha de rede nao e
      // ApiError e cai no texto generico — a distincao importa, porque "o
      // backend recusou" e "sua internet caiu" pedem acoes diferentes.
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

          
        </form>
    </AppModal>
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
