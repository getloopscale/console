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
export function draftProblems(d: GuardrailDraft): string[] {
  const out: string[] = [];
  const name = d.name.trim();

  if (name === '') out.push('Dê um nome à guardrail.');
  else if (RESERVED.has(name.toLowerCase())) {
    out.push(`"${name}" é um nome reservado da plataforma. Escolha outro.`);
  }

  const terms = cleanTerms(d.terms);
  if (terms.length === 0) out.push('Adicione ao menos um termo a bloquear.');

  // Um termo em branco casaria em todo lugar — o serviço rejeita, mas o operador merece saber
  // antes de enviar, e sem descobrir por tentativa.
  if (d.terms.some((t) => t.trim() === '' && t !== '')) {
    out.push('Um dos termos está em branco.');
  }

  if (d.action === 'modify' && d.replacement.trim() === '') {
    out.push('Defina o texto que substitui o termo encontrado.');
  }
  return out;
}

/** Os campos do formulário que podem carregar um problema. */
export type DraftField = 'name' | 'terms' | 'replacement';

/**
 * Os mesmos problemas de `draftProblems`, mas endereçados ao campo que os causou.
 *
 * Existe porque uma lista solta de frases no rodapé do formulário obriga o operador a adivinhar
 * qual campo corrigir — e o `DESIGN.md § 6.2` pede o erro junto do campo, associado por
 * `aria-describedby`. A mensagem é a mesma; o que muda é onde ela aparece.
 */
export function draftProblemsByField(d: GuardrailDraft): Partial<Record<DraftField, string>> {
  const out: Partial<Record<DraftField, string>> = {};
  for (const problem of draftProblems(d)) {
    // `substitui` vem ANTES de `termo`: a frase do replacement é "Defina o texto que substitui o
    // TERMO encontrado" — checar `termo` primeiro a mandaria para o campo errado. O teste que
    // pegou isso vale mais que a ordem parecer arbitrária, então ela fica documentada.
    if (problem.includes('nome') || problem.includes('reservado')) out.name ??= problem;
    else if (problem.includes('substitui')) out.replacement ??= problem;
    else if (problem.includes('termo')) out.terms ??= problem;
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
      return 'Esta mensagem seria bloqueada.';
    case 'modify':
      return typeof v.modified === 'string'
        ? `A mensagem seria reescrita como: ${v.modified}`
        : 'A mensagem seria reescrita.';
    case 'allow':
      return 'Esta mensagem passaria — a regra não a alcança.';
    default:
      return null;
  }
}
