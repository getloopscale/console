/**
 * M33 — projeções do catálogo de descoberta.
 *
 * O catálogo atende quem **não sabe o que existe** — persona que nenhuma jornada anterior cobria:
 * o M31 entrega uma tabela com busca e paginação, que resolve "não perder skill acima de 100" e
 * não resolve "me mostre o que existe".
 *
 * A projeção vive aqui, fora do React, porque o risco #1 declarado no roadmap é **card e tabela
 * divergirem**: um filtro que existe num e não no outro faz o mesmo acervo parecer dois.
 */

export interface CatalogSkill {
  readonly skill_id: string;
  readonly name: string;
  readonly description: string;
  readonly state: string;
  readonly latest_revision_id: string | null;
  readonly category?: string;
  readonly execution?: string;
  /** Quem enxerga a skill (M14, devolvido desde o M31). */
  readonly visibility?: string;
  /** Se a revisão vigente tem vetor — é o que a torna descobrível por intenção. */
  readonly embedded?: boolean;
  readonly lifecycle?: 'active' | 'draft' | 'deprecated';
}

export interface CatalogCard {
  readonly skillId: string;
  readonly name: string;
  readonly description: string;
  readonly category: string | null;
  readonly execution: string | null;
  readonly visibilityText: string;
  /** `true` só quando o registro AFIRMA que há vetor. Ausência não é afirmação. */
  readonly discoverable: boolean;
  readonly lifecycle: CatalogSkill['lifecycle'];
}

/** Minúsculas sem acento — para ordenar "Ágil" antes de "zulu", e não depois. */
function orderKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Traduz a visibilidade para uma frase.
 *
 * Um valor que a tela não conhece **atravessa como veio**: um registro mais novo pode inventar
 * `internal`, e traduzi-lo para "privada" ou "pública" afirmaria algo falso sobre quem enxerga a
 * skill. Ausente vira "não informada" — nunca um dos dois valores conhecidos.
 */
function visibilityText(v: string | undefined): string {
  if (v === undefined || v === '') return 'not reported';
  if (v === 'private') return 'private';
  if (v === 'public') return 'public';
  return v;
}

/**
 * Projeta os cards, em ordem **determinística**.
 *
 * Ordem por nome com **desempate por identificador**: o servidor pode devolver em qualquer ordem,
 * e uma grade que dança entre recargas parece instável sem nada ter mudado. O desempate é o que
 * torna a ordem reproduzível quando dois nomes colidem — e o roadmap pede que o critério seja
 * declarado na própria tela, já que sem sinal de adoção qualquer ordem padrão é arbitrária.
 */
export function catalogCards(skills: readonly CatalogSkill[] | null | undefined): CatalogCard[] {
  if (!Array.isArray(skills)) return [];

  return skills
    .map((s) => ({
      skillId: s.skill_id,
      name: s.name,
      description: s.description,
      category: s.category !== undefined && s.category !== '' ? s.category : null,
      execution: s.execution !== undefined && s.execution !== '' ? s.execution : null,
      visibilityText: visibilityText(s.visibility),
      // `=== true` e não truthy: ausente NÃO conta como descobrível. Um registro que não devolve
      // o campo não afirmou que há vetor, e prometer descoberta que pode não existir é pior que
      // admitir que não se sabe.
      discoverable: s.embedded === true,
      lifecycle: s.lifecycle,
    }))
    .sort((a, b) => {
      const na = orderKey(a.name);
      const nb = orderKey(b.name);
      return na !== nb ? na.localeCompare(nb) : a.skillId.localeCompare(b.skillId);
    });
}

export interface CategoryChips {
  readonly visiveis: string[];
  /** Quantas CATEGORIAS ficaram de fora — não quantas skills. */
  readonly excedente: number;
}

/**
 * Categorias únicas do acervo carregado, com teto e overflow.
 *
 * **Sem contagem por faceta**, por decisão do roadmap: derivada da página carregada, ela
 * afirmaria sobre o ACERVO um número que só vale para o que está na tela. Fica adiada até vir do
 * servidor junto da listagem.
 */
export function categoryChips(skills: readonly CatalogSkill[], ceiling: number): CategoryChips {
  const unicas = [
    ...new Set(
      skills
        .map((s) => s.category)
        .filter((c): c is string => typeof c === 'string' && c.trim() !== ''),
    ),
  ].sort((a, b) => orderKey(a).localeCompare(orderKey(b)));

  const limit = Math.max(0, ceiling);
  return { visiveis: unicas.slice(0, limit), excedente: Math.max(0, unicas.length - limit) };
}
