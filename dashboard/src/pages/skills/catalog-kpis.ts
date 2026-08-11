/**
 * The four numbers of the skill registry (B-126, amendment D1-bis).
 *
 * ## Where this comes from
 *
 * I had decided, in the plan's `D1`, that this screen would answer with a verdict rather than
 * KPIs. The owner decided that every capability opens with the same dashboard `memory` opens with,
 * and that call is theirs: consistency of surface is a property of the product, and whoever
 * operates eight capabilities should not learn eight ways to read the first screen.
 *
 * The verdict STAYS, above these numbers. The amendment adds; it does not replace.
 *
 * ## Why these four
 *
 * All of them derive from the catalogue the screen already fetches — no new request. And the
 * choice avoided the temptation of completing the grid with something like "distinct categories":
 * a number nobody asked for occupies the slot of one somebody would have needed.
 *
 * `deprecated` is a CUT, not a slice: a deprecated skill with a revision is still loadable and
 * appears in both cards. Adding the four up expecting the total is a misreading, which is why the
 * card is called "Deprecated" and not "Other".
 */

export interface CatalogKpis {
  readonly total: number;
  /** Has a current revision — an agent can load it. */
  readonly loadable: number;
  /** Published with no revision: it sits in the registry and nobody can use it. */
  readonly notLoadable: number;
  /** Marked deprecated. A cut, not a slice: it may be loadable too. */
  readonly deprecated: number;
}

interface SkillRow {
  readonly latest_revision_id?: string | null;
  readonly lifecycle?: string;
  readonly category?: string;
}

export function catalogKpis(skills: readonly SkillRow[]): CatalogKpis {
  let loadable = 0;
  let deprecated = 0;

  for (const s of skills) {
    // `undefined` counts as not-loadable alongside `null`: the field is optional in the payload,
    // and treating its absence as success would make the screen claim a skill works based on a
    // field the service never sent.
    if (s.latest_revision_id !== null && s.latest_revision_id !== undefined) loadable += 1;
    if (s.lifecycle === 'deprecated') deprecated += 1;
  }

  return { total: skills.length, loadable, notLoadable: skills.length - loadable, deprecated };
}

/**
 * The registry broken down by category, for the bar chart under the counts (B-129).
 *
 * The four cards answer "how many, and how many work". They do not answer "what is this registry
 * made OF" — which is the question somebody browsing an agent's available skills actually has.
 *
 * Bars and not a line: the catalogue carries no timestamp (`lib/mocks/skills-handlers.ts:23-33`),
 * so there is no time axis to plot. A chart form the data cannot feed is fabrication with axes.
 *
 * Largest first, because the answer to "what is it made of" is at the top of the list; alphabetical
 * would bury it under whatever happens to start with 'a'. Ties break alphabetically so the order is
 * stable across reads — bars that reshuffle on a refresh read as data changing when nothing did.
 */
export function catalogByCategory(skills: readonly SkillRow[]): { label: string; value: number }[] {
  const counts = new Map<string, number>();

  for (const s of skills) {
    // A skill with no category is counted under a name, never dropped. Dropping it would make the
    // bars total less than the "In registry" card directly above, and a reader who notices the gap
    // cannot tell whether it is uncategorised skills or a bug.
    const label = typeof s.category === 'string' && s.category !== '' ? s.category : 'uncategorised';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

/**
 * A coleção que a tela DESCREVE, escolhida entre o acervo acumulado e a página em mãos.
 *
 * ## Por que uma função nomeada e não a expressão solta
 *
 * B-149 — a expressão `paginas.length > 0 ? paginas : pagina` existia inline, e o gráfico de
 * categorias não a usava: ele lia `paginas` direto. No primeiro frame após o sucesso `paginas`
 * ainda está vazio enquanto `pagina` já tem linhas, então a tabela pintava povoada e o gráfico
 * acima dela dizia "Nothing recorded in this window." — a mesma afirmação falsa que o gate de
 * settled-success (`B-161`) foi introduzido para impedir, entrando pela outra porta.
 *
 * A correção não é o gráfico passar a ler `acervo`; é não haver DOIS lugares escolhendo. Com um
 * nome, os dois consumidores leem a mesma decisão e não podem divergir — a mesma disciplina de
 * `lib/list-state.ts`, que tirou do JSX a escolha entre "não há nada" e "não consegui ler".
 *
 * ## Honestidade sobre o teste
 *
 * A divergência era um transiente de UM frame. `render()` do Testing Library roda os efeitos
 * dentro do `act` da montagem, então uma asserção de tela passa VERDE com e sem a correção —
 * exatamente a forma de teste inerte que B-152/B-189 nomeiam. Por isso a garantia mora aqui, numa
 * função pura que um teste consegue reprovar.
 */
export function colecaoDescrita<T>(acumulado: readonly T[], paginaAtual: readonly T[]): readonly T[] {
  return acumulado.length > 0 ? acumulado : paginaAtual;
}
