/**
 * Qual coleção a tela descreve: a acumulada, ou a página que acabou de chegar.
 *
 * B-237 — vivia em `pages/skills/catalog-kpis.ts`, um módulo de KPIs de um domínio, sendo uma
 * decisão de PAGINAÇÃO sem domínio nenhum. Mora aqui pela mesma razão que `calcularPaginacao`: o
 * segundo consumidor não deveria ter de importar de `pages/skills/` para paginar.
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
export function colecaoDescrita<T>(acumulado: readonly T[], currentPage: readonly T[]): readonly T[] {
  return acumulado.length > 0 ? acumulado : currentPage;
}
