import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { policySummary, promotionConsequence } from '@/pages/promptly/components/projections';
import { frasePreRollback } from '@/pages/promptly/components/rollback';
import type { UseMutationResult } from '@tanstack/react-query';

interface Props {
  alvo: number | null;
  setAlvo: (v: number | null) => void;
  labelAlvo: string;
  promote: UseMutationResult<unknown, unknown, { label: string; version: number }, unknown>;
  revAlvo: number | null;
  setRevAlvo: (v: number | null) => void;
  labelRollback: string | null;
  rollback: UseMutationResult<unknown, unknown, { toVersion: number; label: string | null }, unknown>;
  latestVersion: number | null;
  promptName: string;
  /** A revisão que o ambiente serve HOJE — a frase de consequência a compara com o alvo. */
  atualDoLabel: (label: string) => number | null;
  resumoPolitica: ReturnType<typeof policySummary>;
  politicaIlegivel: boolean;
}

/**
 * As duas confirmações destrutivas da tela: promover e reverter.
 *
 * ## Por que juntas, e por que só estas duas
 *
 * Não é "os diálogos que estavam no `detail.tsx`" — esse seria o balde genérico
 * que o `ADR-0001` impede. As duas são a MESMA decisão em sentidos opostos:
 * apontar um ambiente para outra revisão. Uma leva para frente, a outra para
 * trás, e ambas mudam o que a produção serve sem passar por deploy.
 *
 * Por isso confirmam, e por isso confirmam do mesmo jeito. Separá-las faria
 * dois arquivos onde a próxima pessoa teria de comparar as duas para descobrir
 * que a simetria era intencional.
 */
export function ConfirmacoesDePonteiro({
  alvo, setAlvo, labelAlvo, promote, revAlvo, setRevAlvo, labelRollback, rollback, latestVersion, promptName, atualDoLabel, resumoPolitica, politicaIlegivel,
}: Props) {
  return (
    <>
    <ConfirmDialog
      open={alvo !== null}
      onOpenChange={(open) => {
        // O erro NÃO é limpo aqui: o diálogo fecha ao confirmar, inclusive quando o serviço
        // recusa, e limpar neste ponto apagaria no mesmo ciclo a mensagem que explica por que o
        // label continua onde estava. Ele é limpo ao ABRIR um novo diálogo.
        if (!open) {
          setAlvo(null);
        }
      }}
      intent="destructive"
      title={`Promote "${labelAlvo}" to revision v${alvo ?? ''}?`}
      description={
        <>
          <p>{promotionConsequence({ label: labelAlvo, atual: atualDoLabel(labelAlvo), alvo: alvo ?? 0 })}</p>
          <p className="mt-2">
            {/* A regra vigente, ANTES do ato. Ilegível ≠ ausente: o primeiro manda investigar, o
                segundo diz que a promoção é livre. Confundi-los é o defeito que a tela evita. */}
            <strong>Policy: </strong>
            {politicaIlegivel
              ? 'the policy for this label could not be read — the service may refuse the promotion.'
              : resumoPolitica.texto}
          </p>
        </>
      }
      confirmLabel="Promote"
      cancelLabel="Cancelar"
      confirmationPhrase={labelAlvo}
      loading={promote.isPending}
      onConfirm={() => {
        if (alvo === null || labelAlvo === '') return;
        promote.mutate({ label: labelAlvo, version: alvo });
      }}
    />

    {/* M12 — a confirmação de reverter. Nomeia a revisão que será CRIADA: um texto de "volta
        para a v1" faria o operador esperar o histórico encolher, e ele nunca encolhe. */}
    <ConfirmDialog
      open={revAlvo !== null}
      onOpenChange={(aberto) => !aberto && setRevAlvo(null)}
      title={`Roll ${promptName} back to v${revAlvo ?? 0}`}
      description={
        <p className="text-sm">
          {frasePreRollback({
            nome: promptName,
            paraVersao: revAlvo ?? 0,
            ultimaVersao: latestVersion ?? 0,
            label: labelRollback,
          })}
        </p>
      }
      confirmLabel="Roll back"
      cancelLabel="Cancelar"
      confirmationPhrase={promptName}
      loading={rollback.isPending}
      onConfirm={() => {
        if (revAlvo === null) return;
        rollback.mutate({ toVersion: revAlvo, label: labelRollback });
      }}
    />
    </>
  );
}
