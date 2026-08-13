/**
 * M31 — o acervo que aguenta escala.
 *
 * O defeito medido em 2026-08-03: `next_page_token` estava **tipado e não usado**. Acima do teto
 * de uma página o excedente sumia **sem erro algum** — a tela dizia "12 no acervo" com 300 lá
 * dentro, e nada indicava a diferença.
 *
 * O filtro aqui é sobre o que está **carregado**, e a tela precisa dizer isso. Um filtro que
 * parece varrer o acervo inteiro e varre uma página é pior que filtro nenhum: leva o operador a
 * concluir que a skill não existe. Para procurar no acervo todo por intenção, existe a tela de
 * Descoberta — que é busca semântica, não filtro de texto.
 */

export interface SkillRow {
  readonly skill_id: string;
  readonly name: string;
  readonly description: string;
  readonly state: string;
  readonly latest_revision_id: string | null;
  readonly category?: string;
  readonly execution?: string;
  readonly lifecycle?: 'active' | 'draft' | 'deprecated';
  readonly deprecation_reason?: string | null;
  readonly superseded_by?: string | null;
}

/**
 * Mescla a página nova no acervo já carregado, **por identificador**.
 *
 * Dedupe é necessário, não zelo: um clique duplo em "carregar mais" ou um refetch entregam a
 * mesma página de novo, e concatenar cegamente faria a contagem mentir e a `key` do React colidir.
 *
 * A versão mais RECENTE vence — entre uma página e outra a skill pode ter sido editada, e manter
 * a antiga exibiria dado velho ao lado de dado novo sem nada indicando qual é qual.
 */
export function mergePages(
  atual: readonly SkillRow[],
  incomingPage: readonly SkillRow[],
  opts: { readonly primeira?: boolean } = {},
): SkillRow[] {
  // A PRIMEIRA página SUBSTITUI, não mescla — e isto não é detalhe.
  //
  // Medido no CI em 2026-08-04: depois de apagar uma skill, o refetch da primeira página era
  // mesclado no acervo acumulado e a apagada **continuava na tela**. Mesclar nunca remove.
  //
  // A primeira página é o começo da lista: recarregá-la significa "o acervo mudou". Páginas
  // SEGUINTES acumulam, que é o que faz "carregar mais" funcionar.
  if (opts.primeira === true) return [...incomingPage];

  if (incomingPage.length === 0) return [...atual];

  const porId = new Map<string, SkillRow>();
  for (const s of atual) porId.set(s.skill_id, s);
  for (const s of incomingPage) porId.set(s.skill_id, s);

  // A ORDEM de inserção original é preservada pelo `Map`, e é a ordem em que o servidor
  // devolveu — reordenar aqui inventaria um critério que o servidor não usou.
  return [...porId.values()];
}

/**
 * Normaliza para comparação: minúsculas e **sem acento**.
 *
 * Quem digita com pressa não acentua. Sem isso, "cotacao" não acha "Cotação" e o filtro parece
 * quebrado justamente para quem está com pressa.
 */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Filtra o acervo carregado por nome, descrição ou identificador.
 *
 * Os três campos porque o operador chega por caminhos diferentes: lembra do **nome**, lembra do
 * que a skill **faz**, ou tem o **identificador** copiado de um log ou de uma mensagem de erro.
 */
export function filterCollection(acervo: readonly SkillRow[], termo: string): SkillRow[] {
  const t = normalizar(termo.trim());
  if (t === '') return [...acervo];

  return acervo.filter(
    (s) =>
      normalizar(s.name).includes(t) ||
      normalizar(s.description).includes(t) ||
      normalizar(s.skill_id).includes(t),
  );
}
