import { useState } from 'react';
import { formatDeployError, PROMOTE } from '@/pages/deploy/components/deploy-error-copy';
import { ArrowUpToLine } from 'lucide-react';
import {
  Button,
  Input,
  Label,
  useToast,
} from '@getloopscale/ui';
import { AppModal } from '@/components/ui/app-modal';
import { Alert } from '@/components/ui/alert-guard';
import { ApiError } from '@/lib/http/api';
import { usePromote } from '@/hooks/mutations/use-promote';
import { useStartMutation, useEndMutation } from '@/hooks/deploy/use-mutation-in-flight';
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
  const promote = usePromote();
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
      // Backend contract retained: POST /promote { from, to }. A env de
      // preview e a origem; o destino e sempre producao.
      //
      // B-013 — a chamada tem dono: `usePromote`. Um dialogo e uma tela, e
      // enquanto a rede morava aqui o unico jeito de testar a promocao era
      // montar um modal, e a invalidacao de cache dependia de quem abrisse o
      // dialogo lembrar de faze-la.
      //
      // O hook usa `throwOnError`, entao a rejeicao carrega `ApiError` com
      // `status` e `body` — os mesmos dois dados que `formatPromoteError` ja
      // consumia. O `if (!resp.ok)` que cada chamador precisava lembrar de
      // escrever some: um esquecido virava uma promocao que falhava calada.
      const res = await promote.mutateAsync({
        projectName,
        fromEnvironment: sourceBuild.environment ?? '',
      });
      dismiss(progressId);
      if (!res) {
        endMutation(projectName);
        toast({
          title: 'Promote failed',
          description: 'Session expired. Sign in again and retry the promote.',
          variant: 'destructive',
        });
        return;
      }
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
      // B-013 — `formatPromoteError` continua sendo o dono da mensagem por
      // status; o que mudou e a FONTE do status. Antes vinha de `resp.status`
      // depois de um `if (!resp.ok)`; agora vem da `ApiError` que o
      // `throwOnError` levanta. Uma falha de rede nao e ApiError e cai no texto
      // generico — a distincao importa: "seu plano nao permite" e "sua internet
      // caiu" pedem acoes diferentes de quem le.
      const apiErr = e instanceof ApiError ? e : null;
      toast({
        title: 'Promote failed',
        description: apiErr
          ? formatPromoteError(apiErr.status, apiErr.body as { message?: string; code?: string; error?: string } | null)
          : e instanceof Error
            ? `${e.message}. The current production release remains active. Check connection and retry.`
            : 'Network error. The current production release remains active. Check connection and retry.',
        variant: 'destructive',
        duration: null,
      });
    }
  };

  return (
    <AppModal
      open={open}
      onClose={() => onOpenChange(false)}
      title={<>Promote {sha} to production</>}
      icon={<ArrowUpToLine className="size-4" aria-hidden="true" />}
      description={<>This will make <span className="font-mono">{sha}</span> the
            production deploy of{' '}<span className="font-mono">{projectName}</span>. Visitors will see
            this version. The current production release becomes the previous
            release — one click to revert.</>}
      footer={<><Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button><Button
              type="submit" form="promote-to-production-form"
              disabled={phrase !== CONFIRMATION_PHRASE}
            >
              Promote {sha} to production
            </Button></>}
    >
      <form id="promote-to-production-form" onSubmit={handleSubmit} className="space-y-4">
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

          
        </form>
    </AppModal>
  );
}

/**
 * Translate a canonical LoopScaleError body into actionable user-facing
 * copy. Mirrors formatRollbackError — same product-language only
 * policy (Cross-Project Rule 9): we say "deployment infrastructure",
 * never "ArgoCD" or "Kubernetes".
 */
/**
 * B-226 — a escada inteira (ordem de códigos, ramos de status, leitura do corpo) era idêntica à de
 * `formatRollbackError`; só as PALAVRAS diferiam. A forma vive em `deploy-error-copy.ts` e o
 * vocabulário desta operação vive no descritor `PROMOTE`.
 */
export function formatPromoteError(
  status: number,
  body: { message?: string; code?: string; error?: string } | null,
): string {
  return formatDeployError(PROMOTE, status, body);
}
