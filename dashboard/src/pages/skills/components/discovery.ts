/**
 * M31 — projeções da tela de descoberta.
 *
 * A DoD exige que a tela mostre o `score` **e qual perna casou**. A segunda metade é a que carrega
 * o produto: sem ela o painel exibe um número sem dizer de onde veio, e some a diferença entre
 * "achou porque as palavras batem" e "achou porque entendeu" — que é justamente o que o produto
 * vende.
 */

/**
 * As pernas que o registro de fato emite.
 *
 * O vocabulário é `'vector' | 'keyword'` — declarado em `theo-skills`
 * `packages/core/src/domain/retrievers/types.ts:79` e MEDIDO na resposta do app-dev em
 * 2026-08-04. Não é `'lexical'`: esse nome nunca existiu no contrato, e enquanto esta projeção o
 * usou, todo resultado casado por palavra caiu no fallback "origem não informada" — a tela
 * mostrava o score e escondia o motivo, que é a metade do critério que o M31 existe para cumprir.
 */
type KnownLeg = 'keyword' | 'vector';

/**
 * Uma perna casada, na forma que o HANDLER devolve — `{leg, rank}`, não uma string.
 *
 * MEDIDO no app-dev em 2026-08-04. A primeira versão desta projeção assumiu a forma do
 * `hybrid-retriever.ts` (que devolve `matched: string[]` internamente) e lia campos que não
 * existem na resposta HTTP: a tela mostrava "0 resultados" com o serviço devolvendo dois, e os
 * testes passavam porque a fixture repetia a suposição.
 */
export interface MatchedLeg {
  readonly leg: string;
  readonly rank?: number;
}

interface RetrievedSkill {
  readonly skill_id: string;
  readonly name: string;
  readonly description: string;
  readonly score?: number;
  readonly matched?: readonly MatchedLeg[];
}

export interface RetrievePayload {
  /** `results`, não `skills` — a chave que o handler de fato usa. */
  readonly results?: readonly RetrievedSkill[];
}

export interface DiscoveryRow {
  readonly skillId: string;
  readonly name: string;
  readonly description: string;
  /** `null` quando o registro não informou — que é diferente de zero. */
  readonly score: number | null;
  /** A frase que diz o que a máquina fez, não o nome do módulo que fez. */
  readonly legText: string;
}

/**
 * Traduz as pernas casadas para uma frase que diz **o que aconteceu**.
 *
 * Não devolve "keyword"/"vector": esses são nomes de implementação, e o operador precisa saber o
 * que a máquina fez. As duas juntas são um caso PRÓPRIO, não uma enumeração — casar nas duas é o
 * sinal mais forte que o sistema produz, e listá-las lado a lado enterraria isso.
 *
 * Uma perna desconhecida (um registro mais novo pode inventar outra) **não** é traduzida para uma
 * das conhecidas: isso afirmaria algo falso sobre por que a skill apareceu.
 */
export function legLabel(matched: readonly MatchedLeg[] | undefined): string {
  const conhecidas = new Set<KnownLeg>();
  for (const m of matched ?? []) {
    if (m.leg === 'keyword' || m.leg === 'vector') conhecidas.add(m.leg);
  }
  if (conhecidas.has('keyword') && conhecidas.has('vector')) return 'words and intent';
  if (conhecidas.has('keyword')) return 'the words match';
  if (conhecidas.has('vector')) return 'understood the intent';
  return 'origin not reported';
}

export function discoveryRows(payload: RetrievePayload | null | undefined): DiscoveryRow[] {
  const skills = payload?.results;
  if (!Array.isArray(skills)) return [];

  return skills
    .map((s) => ({
      skillId: s.skill_id,
      name: s.name,
      description: s.description,
      // Ausente vira `null`, nunca `0`: zero afirma "casou muito mal", e um registro que não
      // devolve o campo não disse isso. As duas frases levam o operador a conclusões opostas.
      score: typeof s.score === 'number' ? s.score : null,
      legText: legLabel(s.matched),
    }))
    .sort((a, b) => {
      const sa = a.score ?? -1;
      const sb = b.score ?? -1;
      // Desempate por identificador: sem ele a ordem dança entre buscas iguais, e a lista parece
      // instável sem nada ter mudado.
      return sb !== sa ? sb - sa : a.skillId.localeCompare(b.skillId);
    });
}
