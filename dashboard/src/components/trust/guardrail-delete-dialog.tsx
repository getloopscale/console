import { useState } from 'react';

/**
 * M24 T6.1 — a coreografia destrutiva de remover uma guardrail.
 *
 * `DESIGN.md § 2.2` é contrato travado e pede, nesta ordem: impacto escrito, declaração de
 * reversibilidade, **frase digitada verbatim** e botão `destructive` (nunca `primary`).
 *
 * O impacto que este diálogo declara não é "o item some da lista" — é que **uma proteção ativa
 * deixa de valer**. Quem remove precisa ler isso antes, não descobrir depois pelo incidente.
 *
 * O prior art reforça a régua: o PostHog pede confirmação até para mudança de rollout, porque o
 * critério não é "isto apaga dados", é "isto muda produção agora".
 */

export interface GuardrailDeleteDialogProps {
  readonly name: string;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function GuardrailDeleteDialog({
  name,
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: GuardrailDeleteDialogProps) {
  const [typed, setTyped] = useState('');
  const phraseMatches = typed.trim() === name;

  return (
    <div role="dialog" aria-label={`Remover guardrail ${name}`} className="rounded border border-destructive p-4">
      <h2 className="mb-2 text-sm font-semibold">Remover a guardrail “{name}”</h2>

      <p className="mb-2 text-sm">
        Os termos desta regra deixam de ser bloqueados nas conversas deste workspace assim que ela
        for removida. Mensagens que hoje são barradas passarão a seguir adiante.
      </p>
      <p className="mb-3 text-sm font-medium">Esta ação não pode ser desfeita.</p>

      <label className="mb-3 block text-sm">
        <span className="mb-1 block">
          Para confirmar, digite <span className="font-mono font-semibold">{name}</span>
        </span>
        <input
          className="w-full rounded border px-3 py-2 font-mono text-sm"
          aria-label="Confirmação"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>

      {error ? (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        {/*
          O botão de confirmar fica desabilitado — e aqui isso é correto, ao contrário do catálogo:
          a ação existe e pertence ao operador; o que falta é a prova de intenção que ele mesmo
          fornece digitando. O texto acima diz exatamente o que fazer para habilitá-la.
        */}
        <button
          type="button"
          className="rounded bg-destructive px-3 py-2 text-sm text-destructive-foreground disabled:opacity-50"
          disabled={!phraseMatches || busy}
          onClick={onConfirm}
        >
          {busy ? 'Removendo…' : 'Remover guardrail'}
        </button>
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
