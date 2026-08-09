import { Loader2, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
} from '@usetheo/ui';
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
 * Single-app monorepos work transparently (theo-packs autodetect path
 * at build time). Multi-app monorepos with non-root app paths need
 * a schema migration (documented gap, tracked as follow-up).
 */
export interface RedeployDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  sourceBuild: Build;
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

  const errorMessage = redeploy.error
    ? redeploy.error instanceof Error
      ? redeploy.error.message
      : 'Redeploy failed. Try again in a moment.'
    : null;

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
