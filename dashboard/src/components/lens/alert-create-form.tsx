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

import { Button, Input, Select } from '@usetheo/ui';
import { exigeNomeDePrompt } from '@/components/lens/alert-draft';
import type { AlertField } from '@/components/lens/alert-draft';

export interface AlertCreateFormProps {
  readonly name: string;
  readonly onName: (v: string) => void;
  readonly metric: string;
  readonly onMetric: (v: string) => void;
  readonly promptName: string;
  readonly onPromptName: (v: string) => void;
  readonly comparator: string;
  readonly onComparator: (v: string) => void;
  readonly threshold: string;
  readonly onThreshold: (v: string) => void;
  readonly windowSeconds: string;
  readonly onWindowSeconds: (v: string) => void;
  readonly webhookId: string;
  readonly onWebhookId: (v: string) => void;
  readonly webhooks: readonly { id: string; label?: string; url?: string }[];
  readonly metrics: readonly { value: string; label: string }[];
  readonly comparators: readonly { value: string; label: string }[];
  readonly windows: readonly { value: string; label: string }[];
  readonly canCreate: boolean;
  readonly onSubmit: () => void;
  /** O uso medido AGORA do prompt digitado — `undefined` enquanto não há prompt alvo. */
  /** Problemas a EXIBIR — só os campos já tocados. A validação em si vive em `alert-draft.ts`. */
  readonly problems?: Partial<Record<AlertField, string>>;
  readonly usoAtual?: {
    readonly carregando: boolean;
    readonly erro: boolean;
    readonly resolucoes?: number;
    /** A janela que o número cobre — dita, nunca implícita: sem ela o operador o atribui ao período errado. */
    readonly janelaDias: number;
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
        <Input id="rule-name" value={p.name} onChange={(e) => p.onName(e.target.value)} placeholder="High error rate" aria-label="Rule name" />
      </div>
      <div>
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Metric</span>
        <Select value={p.metric} onValueChange={p.onMetric}>
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
      {exigeNomeDePrompt(p.metric) ? (
        <div className="min-w-[160px]">
          <label htmlFor="rule-prompt" className="mb-1 block text-xs font-medium text-muted-foreground">
            Prompt
          </label>
          <Input
            id="rule-prompt"
            value={p.promptName}
            onChange={(e) => p.onPromptName(e.target.value)}
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
        <Select value={p.comparator} onValueChange={p.onComparator}>
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
          value={p.threshold}
          onChange={(e) => p.onThreshold(e.target.value)}
          placeholder="5"
          aria-label="Threshold"
        />
        {/* O valor MEDIDO agora — risco #2 do M22. Um limite escolhido as cegas e o
            alerta mal calibrado, e alerta que dispara sem motivo ensina o time a
            ignorar o canal. Falha de leitura NAO vira zero: sao fatos diferentes. */}
        {p.usoAtual ? (
                      <p className="mt-1 text-xs text-muted-foreground" data-testid="valor-medido">
                        {p.usoAtual.erro
                          ? 'Não foi possível ler o uso atual deste prompt.'
                          : p.usoAtual.carregando
                            ? 'Lendo o uso atual…'
                            : `Hoje: ${p.usoAtual.resolucoes} resoluções nos últimos ${p.usoAtual.janelaDias === 1 ? '1 dia' : `${p.usoAtual.janelaDias} dias`}.`}
                      </p>
                    ) : null}
      </div>
      <div>
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Over</span>
        <Select value={p.windowSeconds} onValueChange={p.onWindowSeconds}>
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
        <Select value={p.webhookId || undefined} onValueChange={p.onWebhookId}>
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
