import { Loader2, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
} from '@getloopscale/ui';
import { AppModal } from '@/components/ui/app-modal';
import { Alert } from '@/components/ui/alert-guard';
import { useRedeploy } from '@/hooks/mutations/use-redeploy';
import type { Build } from '@/lib/api/types';

/**
 * RedeployDialog — Plan J-17 T6.4.
 *
 * Confirms a redeploy of the displayed build. The backend reads the
 * source build's commit_sha + environment + apps_spec and submits a
 * brand-new build identical to the original. After 201, the dialog
 * navigates to the new build's detail page so the user lands on the
 * live timeline immediately.
 *
 * Single-app monorepos work transparently (loopscale-packs autodetect path
 * at build time). Multi-app monorepos with non-root app paths need
 * a schema migration (documented gap, tracked as follow-up).
 */
export interface RedeployDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  sourceBuild: Build;
}

/**
 * The reason a redeploy was refused. The API answers with a problem document
 * whose `detail` says why (a build that is not finished, a scale the plan does
 * not allow); the error's own message only carries the status code.
 */
function describeRedeployError(error: unknown): string {
  const body = (error as { body?: unknown } | null)?.body;
  if (typeof body === 'object' && body !== null) {
    const { detail, message } = body as { detail?: unknown; message?: unknown };
    if (typeof detail === 'string' && detail !== '') return detail;
    if (typeof message === 'string' && message !== '') return message;
  }
  return error instanceof Error ? error.message : 'Redeploy failed. Try again in a moment.';
}

export function RedeployDialog({
  open,
  onOpenChange,
  projectName,
  sourceBuild,
}: RedeployDialogProps) {
  const navigate = useNavigate();
  const redeploy = useRedeploy();

  const sha = sourceBuild.commit_sha.slice(0, 7);

  const handleConfirm = async () => {
    try {
      const resp = await redeploy.mutateAsync(sourceBuild.build_id);
      if (!resp) return;
      onOpenChange(false);
      navigate(
        `/projects/${encodeURIComponent(projectName)}/deployments/${encodeURIComponent(resp.build_id)}`,
      );
    } catch {
      // useMutation surfaces the error in redeploy.error; UI renders below.
    }
  };

  const errorMessage = redeploy.error ? describeRedeployError(redeploy.error) : null;

  return (
    // Sem `size`: o default `md` é `max-w-lg`, a MESMA largura que este arquivo
    // já herdava do default de `ui/dialog`. Zero mudança visual.
    <AppModal
      open={open}
      onClose={() => onOpenChange(false)}
      title={
        <span className="inline-flex items-center gap-2">
          <RefreshCw className="size-5 text-primary" aria-hidden="true" />
          Redeploy {sha}
        </span>
      }
      description={
        <>
          A new build will start from commit{' '}
          <span className="font-mono">{sha}</span> targeting{' '}
          <span className="font-mono">{sourceBuild.environment}</span>. The
          current release stays active until the new one finishes.
        </>
      }
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={redeploy.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={redeploy.isPending}
          >
            {redeploy.isPending && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            {redeploy.isPending ? 'Starting deploy…' : `Redeploy ${sha}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert
          intent="info"
          description="The build uses the same source and apps as the original. Useful for re-running after a transient infra issue or refreshing dependencies."
        />
        {errorMessage && <Alert intent="destructive" description={errorMessage} />}
      </div>
    </AppModal>
  );
}
