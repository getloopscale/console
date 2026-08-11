/**
 * O veredito do acervo de skills (B-126, decisão D1 do plano).
 *
 * ## O defeito que isto fecha
 *
 * `/skills` abria num `<Card>` com `<h2>Published skills</h2>` e um `DataTable`. Medido em
 * 2026-08-11: das sete overviews de capacidade, era a única que não respondia nada — quem chegava
 * via uma LISTA, e uma lista não responde "como está esta capacidade?".
 *
 * ## Por que veredito, e não uma linha de KPIs como as outras cinco
 *
 * A decisão D1 de `capability-overviews-answer-a-question-plan.md` decide pela existência de uma REGRA, não por maioria. `1.284 memórias` não é
 * bom nem ruim, então `memory` usa KPI e está certo. O acervo de skills tem um "deveria": uma
 * skill publicada deveria ser carregável — e `latest_revision_id: null` significa exatamente que
 * ela não é. Está no acervo, e agente nenhum consegue usá-la.
 *
 * `N skills publicadas` não diz isso. O veredito diz, e é a mesma forma que o `trust` já usa —
 * a única das sete que respondia melhor que as outras.
 *
 * ## Quatro estados, e nenhum deles colapsa
 *
 * `unknown` existe separado de `healthy` pela razão que o repositório defende em toda superfície
 * de leitura: um veredito de saúde sobre uma leitura que não aconteceu tranquiliza sobre o que
 * ninguém olhou. E `empty` existe separado porque zero skills é um acervo que ninguém montou, não
 * um acervo em ordem.
 */

export type VerdictKind = 'unknown' | 'empty' | 'healthy' | 'problem';

export interface CatalogVerdict {
  readonly kind: VerdictKind;
  /** A frase que o operador lê. Carrega o número, porque "há problemas" não é acionável. */
  readonly headline: string;
  /** O que a frase não coube dizer. */
  readonly detail: string;
  /**
   * O resumo foi calculado sobre leitura truncada (decisão D2 do plano).
   *
   * A mesma disciplina do `has_more` do `B-114`, um nível acima: lá era uma lista que truncava em
   * silêncio; aqui é um RESUMO calculado sobre uma lista truncada — o que é pior, porque um número
   * parcial apresentado como total não tem como ser desconfiado por quem lê.
   */
  readonly partial: boolean;
}

/** O que a tela leu. `skills: null` é leitura que não aconteceu, e não acervo vazio. */
export interface CatalogReading {
  readonly skills: readonly { readonly latest_revision_id?: string | null }[] | null;
  readonly truncated: boolean;
}

function plural(n: number, singular: string, pluralForma: string): string {
  // Uma frase que diz "2 skill has" é lida como descuido, e descuido na frase faz duvidar do
  // número. A concordância é parte do veredito.
  return `${String(n)} ${n === 1 ? singular : pluralForma}`;
}

export function catalogVerdict(reading: CatalogReading): CatalogVerdict {
  const partial = reading.truncated;

  if (reading.skills === null) {
    return {
      kind: 'unknown',
      headline: "Couldn't read the skill registry.",
      detail: 'This is not a clean bill of health — nothing was checked.',
      partial,
    };
  }

  if (reading.skills.length === 0) {
    return {
      kind: 'empty',
      headline: 'No skills published yet.',
      detail: 'Publish one to let your agents discover and load it.',
      partial,
    };
  }

  // A regra: uma skill publicada deveria ser carregável. Sem revisão vigente, ela não é.
  // Depreciada COM revisão continua carregável — contá-la aqui inflaria o alarme com casos que
  // funcionam, e um alarme que inclui o que está certo deixa de ser lido.
  const semRevisao = reading.skills.filter(
    (s) => s.latest_revision_id === null || s.latest_revision_id === undefined,
  ).length;

  if (semRevisao > 0) {
    return {
      kind: 'problem',
      headline: `${plural(semRevisao, 'skill', 'skills')} cannot be loaded`,
      detail: partial
        ? 'They are published with no current revision. There may be more beyond this page.'
        : 'They are published with no current revision, so no agent can use them.',
      partial,
    };
  }

  return {
    kind: 'healthy',
    headline: `${plural(reading.skills.length, 'skill is', 'skills are')} published and loadable`,
    // `healthy` + truncado é a combinação mais perigosa das quatro: "toda skill publicada tem
    // revisão" sobre uma leitura de 100 num acervo de 300 é uma afirmação sobre a PÁGINA
    // apresentada como afirmação sobre o acervo. A primeira versão deste módulo variava o detalhe
    // só no ramo `problem`, e o teste da tela pegou.
    detail: partial
      ? 'Every skill on this page has a current revision. There may be more beyond this page.'
      : 'Every published skill has a current revision.',
    partial,
  };
}
