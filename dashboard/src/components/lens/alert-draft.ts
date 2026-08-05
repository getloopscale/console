// alert-draft.ts
//
// O rascunho de uma regra de alerta como DADO, e as regras que o julgam — fora do React.
//
// Existe pelo mesmo motivo que `components/trust/guardrail-draft.ts`: é onde dá para provar a
// validação sem montar componente. O que ele adiciona é o **pareamento** métrica↔prompt, que o
// banco torna irrepresentável (`lens_alert_rules_prompt_pairing_check`) e a rota recusa com
// `INVALID_PROMPT`.
//
// Um formulário que permite montar o par inválido não fica mais permissivo — só empurra a recusa
// para depois do clique, onde ela chega como erro de servidor em vez de orientação.

/** A métrica escopada a um prompt (`theo-cloud` v0.83.0, migração `000060`). */
export const METRICA_DE_PROMPT = 'prompt_resolutions';

export type AlertField = 'name' | 'promptName' | 'threshold' | 'webhookId';

export interface AlertDraft {
  readonly name: string;
  readonly metric: string;
  /** Só significa algo na métrica de prompt — ver `exigeNomeDePrompt`. */
  readonly promptName: string;
  readonly comparator: string;
  /** Texto porque vem de um campo de formulário; vira número em `toCreateBody`. */
  readonly threshold: string;
  readonly windowSeconds: string;
  readonly webhookId: string;
}

export const EMPTY_ALERT_DRAFT: AlertDraft = {
  name: '',
  metric: 'error_rate',
  promptName: '',
  comparator: 'gt',
  threshold: '',
  windowSeconds: '3600',
  webhookId: '',
};

/**
 * A métrica exige um prompt?
 *
 * Allow-list por igualdade, nunca prefixo: `startsWith('prompt_')` faria uma métrica futura de nome
 * parecido — mas de outra fonte — pedir um campo que não lhe serve, e o formulário passaria a exigir
 * o que o backend ignora.
 */
export function exigeNomeDePrompt(metric: string): boolean {
  return metric === METRICA_DE_PROMPT;
}

/**
 * Problema por campo. A chave é o campo que o operador precisa corrigir, não a regra violada.
 *
 * NÃO exportado: nada fora deste módulo o consome, e um export sem consumidor é superfície que
 * alguém vai acabar usando por engano. O comportamento é provado pelo contrato público —
 * `alertProblems` (a lista) e `visibleAlertProblems` (a projeção por campo tocado).
 */
function alertProblemsByField(d: AlertDraft): Partial<Record<AlertField, string>> {
  const out: Partial<Record<AlertField, string>> = {};

  if (d.name.trim() === '') out.name = 'Dê um nome ao alerta.';
  if (d.webhookId.trim() === '') out.webhookId = 'Escolha para onde o aviso vai.';

  const limiar = Number(d.threshold);
  if (d.threshold.trim() === '' || !Number.isFinite(limiar)) {
    out.threshold = 'Informe o limite como número.';
  }

  // O pareamento, nos DOIS sentidos — cada um falha em silêncio de um jeito diferente.
  const temNome = d.promptName.trim() !== '';
  if (exigeNomeDePrompt(d.metric) && !temNome) {
    // Sem isto o avaliador não tem o que consultar e pula a regra para sempre: o cliente vê uma
    // regra armada que nunca dispara.
    out.promptName = 'Diga qual prompt este alerta observa.';
  } else if (!exigeNomeDePrompt(d.metric) && temNome) {
    // Aqui o backend simplesmente ignora o campo, e o próximo leitor da regra não sabe dizer se o
    // escopo valia. Recusar é o que mantém a regra legível depois.
    out.promptName = 'Diga qual prompt este alerta observa.';
  }

  return out;
}

/** Todos os problemas, em texto. É quem libera o submit. */
export function alertProblems(d: AlertDraft): string[] {
  return Object.values(alertProblemsByField(d));
}

/**
 * Os problemas que a tela DEVE mostrar: só os campos já tocados.
 *
 * O formulário abre vazio porque esse é o estado inicial legítimo, não um engano do operador.
 * Acusar antes do primeiro toque transforma a tela de partida numa tela de erro — e ensina a
 * ignorar o vermelho justamente onde ele vai importar.
 *
 * Isto governa apenas a EXIBIÇÃO. `alertProblems` continua sendo quem libera o submit.
 */
export function visibleAlertProblems(
  d: AlertDraft,
  touched: ReadonlySet<AlertField>,
): Partial<Record<AlertField, string>> {
  const out: Partial<Record<AlertField, string>> = {};
  for (const [field, problem] of Object.entries(alertProblemsByField(d))) {
    if (touched.has(field as AlertField)) out[field as AlertField] = problem;
  }
  return out;
}

/**
 * O corpo do `POST`.
 *
 * `prompt_name` é **omitido** fora da métrica de prompt: mandá-lo faz o backend recusar por
 * pareamento, e o CHECK vale nos dois sentidos.
 */
export function toCreateBody(d: AlertDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: d.name.trim(),
    metric: d.metric,
    comparator: d.comparator,
    threshold: Number(d.threshold),
    window_seconds: Number(d.windowSeconds),
    webhook_id: d.webhookId,
  };
  // Aparado porque o backend compara o nome literalmente contra o catálogo de prompts.
  if (exigeNomeDePrompt(d.metric)) body.prompt_name = d.promptName.trim();
  return body;
}
