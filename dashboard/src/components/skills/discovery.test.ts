import { describe, expect, it } from 'vitest';

import { discoveryRows, legLabel, type RetrievePayload } from './discovery';

/**
 * M31 — a projeção da tela de descoberta.
 *
 * O critério da DoD é que a tela mostre o `score` **e qual perna casou**. A segunda metade é a que
 * carrega o produto: sem ela o painel exibe um número sem dizer de onde veio, e some a diferença
 * entre "achou porque as palavras batem" e "achou porque entendeu".
 */

describe('legLabel', () => {
  it('traduz as duas pernas para frases que dizem o que aconteceu', () => {
    // Não "lexical"/"vector": esses são nomes de implementação. O operador precisa saber o que a
    // máquina fez, não como o módulo se chama.
    expect(legLabel(['lexical'])).toBe('as palavras batem');
    expect(legLabel(['vector'])).toBe('entendeu a intenção');
  });

  it('as duas juntas são um caso próprio, não uma lista', () => {
    // Casar nas duas pernas é o sinal MAIS forte que o sistema produz — dizer "as palavras batem,
    // entendeu a intenção" enterraria isso numa enumeração.
    expect(legLabel(['lexical', 'vector'])).toBe('palavras e intenção');
    expect(legLabel(['vector', 'lexical'])).toBe('palavras e intenção');
  });

  it('nenhuma perna conhecida NÃO vira frase inventada', () => {
    // Um registro mais novo pode devolver uma perna que esta tela não conhece. Traduzi-la para
    // uma das duas conhecidas afirmaria algo falso sobre por que a skill apareceu.
    expect(legLabel([])).toBe('origem não informada');
    expect(legLabel(['semantic-v2'])).toBe('origem não informada');
  });

  it('uma perna conhecida entre desconhecidas ainda é reconhecida', () => {
    expect(legLabel(['semantic-v2', 'lexical'])).toBe('as palavras batem');
  });
});

describe('discoveryRows', () => {
  const payload: RetrievePayload = {
    skills: [
      { skill_id: 'sk_b', name: 'B', description: 'd', score: 0.4, matched: ['lexical'] },
      { skill_id: 'sk_a', name: 'A', description: 'd', score: 0.9, matched: ['lexical', 'vector'] },
    ],
  };

  it('ordena do maior score para o menor — quem lê quer o topo', () => {
    expect(discoveryRows(payload).map((r) => r.skillId)).toEqual(['sk_a', 'sk_b']);
  });

  it('empate desempata por identificador, para a ordem não dançar entre buscas', () => {
    const rows = discoveryRows({
      skills: [
        { skill_id: 'sk_z', name: 'Z', description: '', score: 0.5, matched: ['vector'] },
        { skill_id: 'sk_a', name: 'A', description: '', score: 0.5, matched: ['vector'] },
      ],
    });
    expect(rows.map((r) => r.skillId)).toEqual(['sk_a', 'sk_z']);
  });

  it('cada linha carrega a frase da perna, não o nome do módulo', () => {
    const [primeira] = discoveryRows(payload);
    expect(primeira?.legText).toBe('palavras e intenção');
  });

  it('score ausente vira null, não zero — são frases diferentes', () => {
    // `0` afirma "casou muito mal". `null` admite "o registro não informou". Um registro mais
    // antigo pode não devolver score, e inventar zero classificaria a skill como péssima.
    const [linha] = discoveryRows({
      skills: [{ skill_id: 'sk_a', name: 'A', description: '', matched: ['lexical'] } as never],
    });
    expect(linha?.score).toBeNull();
  });

  it('payload ausente devolve lista vazia sem lançar', () => {
    expect(discoveryRows(null)).toEqual([]);
    expect(discoveryRows(undefined)).toEqual([]);
    expect(discoveryRows({} as RetrievePayload)).toEqual([]);
  });
});
