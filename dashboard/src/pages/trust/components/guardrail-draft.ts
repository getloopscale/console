/**
 * M24 — o rascunho de uma guardrail, e as regras que decidem se ele pode ser salvo.
 *
 * Vive fora do React porque a pergunta "este rascunho pode virar produção?" é lógica de domínio,
 * não de renderização — e porque testá-la exige apenas dados.
 *
 * A decisão de produto que este arquivo carrega: **o operador só escolhe `ban-list`**. O serviço
 * aceita seis kinds, e expor todos seria confundir poder com utilidade:
 *
 *   - `regex-match` convida um padrão catastrófico escrito às pressas na barra de endereços;
 *   - `moderation` responde 422 neste deploy (não há classificador ligado), então o formulário
 *     ofereceria uma opção que só produz erro;
 *   - `pii`, `jailbreak` e `credential-mask` já vêm ligados como padrão de plataforma — criar um
 *     duplicado do tenant não adiciona proteção, adiciona confusão sobre qual está valendo.
 *
 * `ban-list` é o que um operador não-especialista usa corretamente: termos que ele escolhe, e a
 * decisão de bloquear ou mascarar. Os termos são escapados pelo serviço, então não há ReDoS.
 */

type GuardrailAction = 'block' | 'modify';

export interface GuardrailDraft {
  readonly name: string;
  readonly terms: readonly string[];
  readonly action: GuardrailAction;
  readonly replacement: string;
}

export const EMPTY_DRAFT: GuardrailDraft = {
  name: '',
  terms: [],
  action: 'block',
  replacement: '[redigido]',
};

/** Nomes que a plataforma reserva — o serviço rejeita com 422 e a tela avisa antes. */
const RESERVED = new Set(['pii', 'shell', 'jailbreak', 'moderation', 'credential-mask', 'prohibited-content']);

/**
 * Por que a tela valida antes de enviar, se o serviço já valida: o `422` chega depois de uma ida
 * ao servidor, e o operador perde o contexto do campo que errou. Isto é conveniência — **não**
 * substitui a validação do serviço, que continua sendo a autoridade (o `422` dele é renderizado
 * com a mensagem própria quando escapa daqui).
 */
/** Os campos do formulário que podem carregar um problema. */
export type DraftField = 'name' | 'terms' | 'replacement';

/**
 * Um problema de validação e o campo a que ele pertence.
 *
 * O campo é DADO, não algo deduzido da frase (B-111). A versão anterior devolvia apenas a
 * string e um segundo passo adivinhava o campo por `includes('nome')` / `includes('termo')` —
 * o que quebrou, em silêncio, no dia em que o painel foi traduzido: a lista de problemas
 * seguia correta e só a associação com o campo sumia, então a tela dizia "há um erro" sem
 * dizer ONDE. Texto de interface é escrito para humanos e reescrito o tempo todo; usá-lo como
 * chave de roteamento é acoplar a lógica à redação.
 */
export interface ProblemaDeCampo {
  readonly campo: DraftField;
  readonly mensagem: string;
}

export function draftProblems(d: GuardrailDraft): readonly ProblemaDeCampo[] {
  const out: ProblemaDeCampo[] = [];
  const name = d.name.trim();

  if (name === '') out.push({ campo: 'name', mensagem: 'Give the guardrail a name.' });
  else if (RESERVED.has(name.toLowerCase())) {
    out.push({
      campo: 'name',
      mensagem: `"${name}" is a name reserved by the platform. Choose another.`,
    });
  }

  const terms = cleanTerms(d.terms);
  if (terms.length === 0) out.push({ campo: 'terms', mensagem: 'Add at least one term to block.' });

  // Um termo em branco casaria em todo lugar — o serviço rejeita, mas o operador merece saber
  // antes de enviar, e sem descobrir por tentativa.
  if (d.terms.some((t) => t.trim() === '' && t !== '')) {
    out.push({ campo: 'terms', mensagem: 'One of the terms is blank.' });
  }

  if (d.action === 'modify' && d.replacement.trim() === '') {
    out.push({ campo: 'replacement', mensagem: 'Set the text that replaces the term found.' });
  }
  return out;
}

/**
 * Os mesmos problemas de `draftProblems`, mas endereçados ao campo que os causou.
 *
 * Existe porque uma lista solta de frases no rodapé do formulário obriga o operador a adivinhar
 * qual campo corrigir — e o `DESIGN.md § 6.2` pede o erro junto do campo, associado por
 * `aria-describedby`. A mensagem é a mesma; o que muda é onde ela aparece.
 */
export function draftProblemsByField(d: GuardrailDraft): Partial<Record<DraftField, string>> {
  const out: Partial<Record<DraftField, string>> = {};
  // Uma indexação, não uma dedução. O primeiro problema de cada campo vence — é o mais alto na
  // ordem em que `draftProblems` os produz, e é o que o operador precisa resolver primeiro.
  for (const { campo, mensagem } of draftProblems(d)) out[campo] ??= mensagem;
  return out;
}

/**
 * Os problemas que a tela pode MOSTRAR agora: só os dos campos que o operador já visitou.
 *
 * O formulário abre vazio porque esse é o estado inicial legítimo, não um engano dele. Acusar
 * "Dê um nome à guardrail" antes do primeiro toque transforma a tela de partida numa tela de
 * erro — e ensina a ignorar o vermelho justamente onde ele vai importar, na hora de gravar algo
 * que passa a bloquear conversa de produção.
 *
 * Isto governa apenas a EXIBIÇÃO. A validação em si não afrouxa: `draftProblems` continua sendo
 * quem libera o dry-run, e o serviço continua sendo a autoridade final.
 */
export function visibleFieldProblems(
  d: GuardrailDraft,
  touched: ReadonlySet<DraftField>,
): Partial<Record<DraftField, string>> {
  const out: Partial<Record<DraftField, string>> = {};
  for (const [field, problem] of Object.entries(draftProblemsByField(d))) {
    if (touched.has(field as DraftField)) out[field as DraftField] = problem;
  }
  return out;
}

/** Termos utilizáveis: sem brancos, sem duplicatas, preservando a ordem que o operador digitou. */
export function cleanTerms(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const t = raw.trim();
    if (t === '' || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/** O corpo que o BFF envia ao serviço. */
export function toCreateBody(d: GuardrailDraft): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    kind: 'ban-list',
    terms: cleanTerms(d.terms),
    action: d.action,
    wholeWord: true,
    caseInsensitive: true,
  };
  // `replacement` só faz sentido quando a ação é `modify`; mandá-lo em `block` seria um campo
  // ignorado que sugere um comportamento que não existe.
  if (d.action === 'modify') spec.replacement = d.replacement.trim();
  return { name: d.name.trim(), spec };
}

/** O corpo do dry-run: a mesma spec, mais o texto de amostra. */
export function toTestBody(d: GuardrailDraft, sample: string): Record<string, unknown> {
  return { spec: (toCreateBody(d) as { spec: unknown }).spec, content: sample, direction: 'input' };
}

/** O veredito do dry-run, como a tela precisa lê-lo. */
export interface DryRunVerdict {
  readonly action?: string;
  readonly policy?: string;
  readonly reason?: string;
  readonly modified?: string;
  readonly [k: string]: unknown;
}

/**
 * Traduz o veredito para a frase que o operador lê.
 *
 * O texto diz o que ACONTECERIA, no futuro do pretérito, porque o dry-run não alterou nada — dizer
 * "bloqueado" faria o operador acreditar que a regra já está valendo.
 */
export function verdictSummary(v: DryRunVerdict | null | undefined): string | null {
  if (!v || typeof v.action !== 'string') return null;
  switch (v.action) {
    case 'block':
      return 'This message would be blocked.';
    case 'modify':
      return typeof v.modified === 'string'
        ? `The message would be rewritten as: ${v.modified}`
        : 'The message would be rewritten.';
    case 'allow':
      return 'This message would pass — the rule does not reach it.';
    default:
      return null;
  }
}
