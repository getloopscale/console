// alert-create-form.tsx
//
// O formulário de criação, separado da página.
//
// Saiu de `pages/lens/alerts.tsx` no M22: a página passou de 463 para 526 linhas ao ganhar a
// métrica escopada a prompt, e o orçamento da casa é 500. Extrair o formulário é a mitigação que
// o plano já declarava — tirar responsabilidade de dentro, em vez de acrescentar.
//
// É presentational puro: todo estado vive na página, toda validação vive em `alert-draft.ts`.
// Nada aqui busca dado nem decide se o par métrica↔prompt é válido.

import { Button, Input, Select } from '@getloopscale/ui';
import { requiresPromptName } from '@/pages/lens/components/alert-draft';
import type { AlertDraft } from '@/pages/lens/components/alert-draft';
import type { AlertField } from '@/pages/lens/components/alert-draft';

export interface AlertCreateFormProps {
  /** O rascunho inteiro. Espelhar campo a campo duplicaria um tipo que já existe. */
  readonly draft: AlertDraft;
  /** Um ponto de mudança para todos os campos — é o que faz `touched` cair de graça na página. */
  readonly onChange: (field: keyof AlertDraft, value: string) => void;
  readonly webhooks: readonly { id: string; label?: string; url?: string }[];
  readonly metrics: readonly { value: string; label: string }[];
  readonly comparators: readonly { value: string; label: string }[];
  readonly windows: readonly { value: string; label: string }[];
  readonly canCreate: boolean;
  readonly onSubmit: () => void;
  /** Problemas a EXIBIR — só os campos já tocados. A validação em si vive em `alert-draft.ts`. */
  readonly problems?: Partial<Record<AlertField, string>>;
  /** O uso medido AGORA do prompt digitado — ausente enquanto não há prompt alvo. */
  readonly currentUsage?: {
    readonly loading: boolean;
    readonly failure: boolean;
    readonly resolucoes?: number;
    /** A janela que o número cobre — dita, nunca implícita: sem ela o operador o atribui ao período errado. */
    readonly windowDays: number;
  };
}

export function AlertCreateForm(p: AlertCreateFormProps) {
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!p.canCreate) return;
        p.onSubmit();
      }}
    >
      <div className="min-w-[160px] flex-1">
        <label htmlFor="rule-name" className="mb-1 block text-xs font-medium text-muted-foreground">
          Name
        </label>
        <Input
          id="rule-name"
          value={p.draft.name}
          onChange={(e) => p.onChange('name', e.target.value)}
          placeholder="High error rate"
          aria-label="Rule name"
          aria-invalid={p.problems?.name ? true : undefined}
        />
        {p.problems?.name ? <p className="mt-1 text-xs text-destructive">{p.problems.name}</p> : null}
      </div>
      <div>
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Metric</span>
        <Select value={p.draft.metric} onValueChange={(v) => p.onChange('metric', v)}>
          <Select.Trigger className="w-[160px]" aria-label="Metric">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {p.metrics.map((m) => (
              <Select.Item key={m.value} value={m.value}>
                {m.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
      {requiresPromptName(p.draft.metric) ? (
        <div className="min-w-[160px]">
          <label htmlFor="rule-prompt" className="mb-1 block text-xs font-medium text-muted-foreground">
            Prompt
          </label>
          <Input
            id="rule-prompt"
            value={p.draft.promptName}
            onChange={(e) => p.onChange('promptName', e.target.value)}
            placeholder="saudacao"
            aria-label="Prompt"
            aria-invalid={p.problems?.promptName ? true : undefined}
          />
          {/* Um botão desabilitado sem explicação viola `DESIGN.md § 6` (erros como diagnóstico):
              o operador vê que não pode criar e não descobre o que falta. */}
          {p.problems?.promptName ? (
            <p className="mt-1 text-xs text-destructive">{p.problems.promptName}</p>
          ) : null}
        </div>
      ) : null}
      <div>
        <span className="mb-1 block text-xs font-medium text-muted-foreground">When</span>
        <Select value={p.draft.comparator} onValueChange={(v) => p.onChange('comparator', v)}>
          <Select.Trigger className="w-[80px]" aria-label="Comparator">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {p.comparators.map((c) => (
              <Select.Item key={c.value} value={c.value}>
                {c.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
      <div>
        <label htmlFor="rule-threshold" className="mb-1 block text-xs font-medium text-muted-foreground">
          Threshold
        </label>
        <Input
          id="rule-threshold"
          type="number"
          className="w-[110px]"
          value={p.draft.threshold}
          onChange={(e) => p.onChange('threshold', e.target.value)}
          placeholder="5"
          aria-label="Threshold"
          aria-invalid={p.problems?.threshold ? true : undefined}
        />
        {p.problems?.threshold ? (
          <p className="mt-1 text-xs text-destructive">{p.problems.threshold}</p>
        ) : null}
        {/* O valor MEDIDO agora — risco #2 do M22. Um limite escolhido as cegas e o
            alerta mal calibrado, e alerta que dispara sem motivo ensina o time a
            ignorar o canal. Falha de leitura NAO vira zero: sao fatos diferentes. */}
        {p.currentUsage ? (
                      <p className="mt-1 text-xs text-muted-foreground" data-testid="valor-medido">
                        {p.currentUsage.failure
                          ? 'Could not read the current usage of this prompt.'
                          : p.currentUsage.loading
                            ? 'Reading current usage…'
                            : // Sem "Hoje": o prefixo mentia sobre o período em toda janela maior
                              // que um dia, e o número é justamente a base do limiar.
                              `${p.currentUsage.resolucoes} resolutions ${
                                p.currentUsage.windowDays === 1 ? 'in the last 24 h' : `in the last ${p.currentUsage.windowDays} days`
                              } — the same window as this rule.`}
                      </p>
                    ) : null}
      </div>
      <div>
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Over</span>
        <Select value={p.draft.windowSeconds} onValueChange={(v) => p.onChange('windowSeconds', v)}>
          <Select.Trigger className="w-[140px]" aria-label="Window">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {p.windows.map((wnd) => (
              <Select.Item key={wnd.value} value={wnd.value}>
                {wnd.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
      <div>
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Notify</span>
        <Select value={p.draft.webhookId || undefined} onValueChange={(v) => p.onChange('webhookId', v)}>
          <Select.Trigger className="w-[200px]" aria-label="Notify webhook">
            <Select.Value placeholder="Select a webhook" />
          </Select.Trigger>
          <Select.Content>
            {p.webhooks.map((wh) => (
              <Select.Item key={wh.id} value={wh.id}>
                {wh.label ?? wh.url ?? wh.id}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
      <Button type="submit" disabled={!p.canCreate}>
        Create rule
      </Button>
    </form>
  );
}
