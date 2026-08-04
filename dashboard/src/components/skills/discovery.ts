/**
 * M31 — projeções da tela de descoberta.
 *
 * A DoD exige que a tela mostre o `score` **e qual perna casou**. A segunda metade é a que carrega
 * o produto: sem ela o painel exibe um número sem dizer de onde veio, e some a diferença entre
 * "achou porque as palavras batem" e "achou porque entendeu" — que é justamente o que o produto
 * vende.
 */

/** As pernas que a busca híbrida do registro reporta hoje (`hybrid-retriever.ts`). */
type KnownLeg = 'lexical' | 'vector';

export interface RetrievedSkill {
  readonly skill_id: string;
  readonly name: string;
  readonly description: string;
  readonly score?: number;
  readonly matched?: readonly string[];
}

export interface RetrievePayload {
  readonly skills?: readonly RetrievedSkill[];
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
 * Não devolve "lexical"/"vector": esses são nomes de implementação, e o operador precisa saber o
 * que a máquina fez. As duas juntas são um caso PRÓPRIO, não uma enumeração — casar nas duas é o
 * sinal mais forte que o sistema produz, e listá-las lado a lado enterraria isso.
 *
 * Uma perna desconhecida (um registro mais novo pode inventar outra) **não** é traduzida para uma
 * das conhecidas: isso afirmaria algo falso sobre por que a skill apareceu.
 */
export function legLabel(matched: readonly string[] | undefined): string {
  const conhecidas = new Set<KnownLeg>();
  for (const m of matched ?? []) {
    if (m === 'lexical' || m === 'vector') conhecidas.add(m);
  }
  if (conhecidas.has('lexical') && conhecidas.has('vector')) return 'palavras e intenção';
  if (conhecidas.has('lexical')) return 'as palavras batem';
  if (conhecidas.has('vector')) return 'entendeu a intenção';
  return 'origem não informada';
}

export function discoveryRows(payload: RetrievePayload | null | undefined): DiscoveryRow[] {
  const skills = payload?.skills;
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
