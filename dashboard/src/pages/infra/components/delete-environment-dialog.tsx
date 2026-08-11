import { useEffect, useRef, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import {
  Button,
  Input,
  Label,
} from '@usetheo/ui';
import { AppModal } from '@/components/ui/app-modal';
import { Alert } from '@/components/ui/alert-guard';
import { useDeleteEnvironment } from '@/hooks/mutations/use-environments';

/**
 * Cascade payload — what backend reports will be deleted.
 * v1.0: pure UX surface (we don't yet have GET /environments/:name/cascade-preview);
 * caller can pass placeholder counts. v1.1 future: live GET pre-flight.
 */
export interface CascadePayload {
  workloads?: number;
  secrets?: number;
  domains?: number;
}

interface DeleteEnvironmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  envName: string;
  // Exclusão pela tupla (projeto, ambiente): a URL do DELETE leva `?project=<slug>` para o
  // serviço filtrar pela tupla — apagar `staging` de `web` NÃO toca o `staging` de `api`.
  //
  // OBRIGATÓRIO desde a remoção do legado (issue #377). Era opcional para atender "chamadores
  // antigos" que caíam numa busca sem projeto; não existe chamador assim — a tela de
  // environments é a única e sempre passa o projeto, porque só renderiza linhas cujo projeto
  // casa o da rota. Opcionalidade sem chamador é um caminho que ninguém exercita e que a
  // próxima pessoa acredita existir.
  project: string;
  cascade?: CascadePayload;
  onDeleted?: () => void;
}

/**
 * DeleteEnvironmentDialog — Plan J-10 v1.1 T2.2 (NEW).
 *
 * Replaces the v1.0 ConfirmDialog which had no type-to-confirm + no cascade
 * warning. v1.1 absorbs blueprint § 2.2 Vercel + Railway hybrid pattern:
 *
 *   - Cascade warning section: lists what will be deleted (workloads + secrets
 *     + domains) so user knows blast radius BEFORE confirming.
 *   - Type-to-confirm input requires exact env name (case-sensitive). Confirm
 *     button disabled until exact match.
 *   - Cancel button = default focus on dialog open (WCAG 2.2 AA destructive
 *     ops — never default focus on destructive action).
 *   - aria-describedby on the input linking to the instruction text.
 *   - ARIA live region announces the action result for screen readers.
 *   - Esc cancels (provided by Radix Dialog).
 *   - Enter submits only when input matches; otherwise disabled.
 *
 * Backend typed errors caught (per blueprint § 4.2):
 *   - 409 RELEASE_ACTIVE: cannot delete env while a release is ACTIVE there
 *   - 409 DEPLOY_IN_PROGRESS: cannot delete during another deploy
 *   - 404: env not found (race condition — likely already deleted)
 *
 * Hard delete only (no soft-delete grace period) per ADR D9 — matches
 * Vercel/Railway parity; PG schema has no deleted_at on environments table.
 */
export function DeleteEnvironmentDialog({
  open,
  onOpenChange,
  envName,
  project,
  cascade,
  onDeleted,
}: DeleteEnvironmentDialogProps) {
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const deleteEnv = useDeleteEnvironment();

  const matches = confirmText === envName;

  // Reset state on each open.
  useEffect(() => {
    if (open) {
      setConfirmText('');
      setError(null);
    }
  }, [open, envName]);

  // Focus management — Cancel button gets initial focus on open.
  useEffect(() => {
    if (open) {
      // Defer to next tick so Radix has finished mounting.
      const t = window.setTimeout(() => cancelRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches) return;
    setError(null);
    try {
      // Propaga `project` para o serviço filtrar pela tupla (nome, projeto).
      const res = await deleteEnv.mutateAsync({ name: envName, project });
      if (res === null) {
        setError(
          `Couldn't delete environment "${envName}". It may have an active ` +
            `release or another deploy in progress. Try again in a moment.`,
        );
        return;
      }
      onDeleted?.();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Delete failed: ${err.message}.`
          : 'Delete failed.',
      );
    }
  };

  const cascadeLines: string[] = [];
  if (cascade?.workloads !== undefined && cascade.workloads > 0) {
    cascadeLines.push(`${cascade.workloads} workload${cascade.workloads !== 1 ? 's' : ''}`);
  }
  if (cascade?.secrets !== undefined && cascade.secrets > 0) {
    cascadeLines.push(`${cascade.secrets} secret${cascade.secrets !== 1 ? 's' : ''}`);
  }
  if (cascade?.domains !== undefined && cascade.domains > 0) {
    cascadeLines.push(`${cascade.domains} domain${cascade.domains !== 1 ? 's' : ''}`);
  }

  return (
    <AppModal
      open={open}
      onClose={() => onOpenChange(false)}
      title={<span className="inline-flex items-center gap-2"><Trash2 className="size-5" aria-hidden="true" />Delete environment {envName}?</span>}
      description={<>This action is permanent and cannot be undone.</>}
      footer={<><Button
              ref={cancelRef}
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={deleteEnv.isPending}
            >
              Cancel
            </Button><Button
              type="submit" form="delete-environment-form"
              variant="destructive"
              disabled={!matches || deleteEnv.isPending}
            >
              {deleteEnv.isPending && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              {deleteEnv.isPending ? 'Deleting…' : `Delete ${envName}`}
            </Button></>}
    >
      <form id="delete-environment-form" onSubmit={handleSubmit} className="space-y-4">
          {/* Cascade warning section per blueprint § 2.2 — what will be deleted. */}
          {cascadeLines.length > 0 ? (
            <Alert
              intent="warning"
              title="Cascade delete"
              description={
                <>
                  <p className="mb-1">Deleting this environment will also delete:</p>
                  <ul className="list-disc list-inside text-body-sm">
                    {cascadeLines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </>
              }
            />
          ) : (
            <Alert
              intent="warning"
              description="All workloads, secrets, and domains scoped to this environment will be deleted."
            />
          )}

          <div className="space-y-1">
            <Label htmlFor="delete-confirm-input">
              Type{' '}
              <span className="font-mono font-semibold text-foreground">{envName}</span>{' '}
              to confirm
            </Label>
            <Input
              id="delete-confirm-input"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              aria-describedby="delete-confirm-help"
              aria-invalid={confirmText.length > 0 && !matches}
              autoComplete="off"
              spellCheck={false}
            />
            <span id="delete-confirm-help" className="text-label text-muted-foreground">
              Match the environment name exactly (case-sensitive).
            </span>
          </div>

          {/* ARIA live region for screen reader status updates. */}
          <div role="status" aria-live="polite" className="sr-only">
            {deleteEnv.isPending && `Deleting environment ${envName}…`}
            {error && `Error: ${error}`}
          </div>

          {error && <Alert intent="destructive" description={error} />}

          
        </form>
    </AppModal>
  );
}
