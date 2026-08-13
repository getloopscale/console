import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { useDeleteSecret } from '@/hooks/mutations/use-secrets-mutations';
import type { Secret } from '@/lib/api/types';

interface DeleteSecretDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secret: Secret | null;
  /** Env to remove the secret from (one per dialog instance). */
  environment?: string;
  project?: string;
  onDeleted?: () => void;
}

/**
 * J-22 T3.4 — DeleteSecretDialog (Vercel-canonical destructive pattern).
 *
 * O botão de excluir fica DESABILITADO até que o nome exato do segredo seja digitado
 * (sensível a maiúsculas — EC-19). Colar é permitido; diferença de caixa mantém desabilitado.
 *
 * Escopo por ambiente: cada exclusão remove o segredo de UM ambiente. Removê-lo de todos exige
 * várias exclusões.
 *
 * ## B-195 — isto era um diálogo próprio
 *
 * Reimplementava a mesma regra de digite-para-confirmar que `ConfirmDialog` já tem —
 * `useState('')`, comparação exata, botão desabilitado — mais o modal, o rodapé e o tratamento
 * de erro. Três coisas se ganham ao migrar, e nenhuma é estética:
 *
 * - O foco. `ConfirmDialog` foca o botão CANCELAR ao abrir, deliberadamente, para que um Enter
 *   apressado não execute a ação destrutiva. Esta cópia dava `autoFocus` ao campo de texto.
 * - O erro fica visível no próprio painel, e o diálogo não fecha em cima de uma falha — a
 *   correção do B-105, que esta cópia não tinha herdado.
 * - Uma regra só. Qualquer melhoria futura na confirmação destrutiva chega aqui sozinha.
 *
 * `RotateSecretDialog` NÃO migra, e a razão é de forma: ele hospeda um segundo campo (o valor
 * novo do segredo). Isso o torna um formulário, e `ConfirmDialog` é uma confirmação — não tem
 * nem deve ter um espaço para campos arbitrários.
 */
export function DeleteSecretDialog({
  open,
  onOpenChange,
  secret,
  environment,
  project,
  onDeleted,
}: DeleteSecretDialogProps) {
  const deleteSecret = useDeleteSecret();

  if (!secret) return null;

  const remove = async () => {
    const env = environment ?? secret.environments?.[0] ?? 'production';
    try {
      await deleteSecret.mutateAsync({ name: secret.name, environment: env, project });
    } catch (err) {
      // Dizer que o segredo CONTINUA lá é a parte que importa: sem isso, quem viu a falha não
      // sabe se precisa tentar de novo ou se acabou de excluir duas vezes.
      throw new Error(
        err instanceof Error
          ? `Delete failed: ${err.message}. The secret was NOT removed.`
          : 'Delete failed. The secret was NOT removed.',
        // A causa original acompanha o sintoma: a frase acima é para quem está na tela, e a
        // cadeia é para quem for depurar.
        { cause: err },
      );
    }
    onDeleted?.();
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${secret.name}`}
      description={`This permanently removes the secret from ${environment ?? 'this environment'}. Apps reading it will fail on next deploy.`}
      confirmLabel="Delete"
      intent="destructive"
      confirmationPhrase={secret.name}
      onConfirm={remove}
      loading={deleteSecret.isPending}
    />
  );
}
