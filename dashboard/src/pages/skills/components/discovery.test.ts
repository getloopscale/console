// @vitest-environment node
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
    // Não "keyword"/"vector": esses são nomes de implementação. O operador precisa saber o que a
    // máquina fez, não como o módulo se chama.
    expect(legLabel([{ leg: 'keyword', rank: 1 }])).toBe('the words match');
    expect(legLabel([{ leg: 'vector', rank: 1 }])).toBe('understood the intent');
  });

  it('as duas juntas são um caso próprio, não uma lista', () => {
    // Casar nas duas pernas é o sinal MAIS forte que o sistema produz — dizer "as palavras batem,
    // entendeu a intenção" enterraria isso numa enumeração.
    expect(
      legLabel([
        { leg: 'keyword', rank: 1 },
        { leg: 'vector', rank: 2 },
      ]),
    ).toBe('words and intent');
    expect(
      legLabel([
        { leg: 'vector', rank: 1 },
        { leg: 'keyword', rank: 2 },
      ]),
    ).toBe('words and intent');
  });

  it('nenhuma perna conhecida NÃO vira frase inventada', () => {
    // Um registro mais novo pode devolver uma perna que esta tela não conhece. Traduzi-la para
    // uma das duas conhecidas afirmaria algo falso sobre por que a skill apareceu.
    expect(legLabel([])).toBe('origin not reported');
    expect(legLabel([{ leg: 'semantic-v2', rank: 1 }])).toBe('origin not reported');
  });

  it('uma perna conhecida entre desconhecidas ainda é reconhecida', () => {
    expect(
      legLabel([
        { leg: 'semantic-v2', rank: 1 },
        { leg: 'keyword', rank: 2 },
      ]),
    ).toBe('the words match');
  });

  it('o vocabulário é o do registro — "lexical" NÃO é uma perna que existe', () => {
    // MEDIDO no app-dev em 2026-08-04, com o servidor respondendo
    // `matched: [{"leg":"keyword","rank":1}]` e a tela exibindo "ORIGEM NÃO INFORMADA".
    //
    // O contrato é `leg: 'vector' | 'keyword'` (loopskills
    // `packages/core/src/domain/retrievers/types.ts:79`). A primeira versão desta projeção
    // inventou `'lexical'` — um nome plausível que o registro nunca emitiu — e por isso TODO
    // resultado casado por palavra caía no fallback. O score aparecia; o porquê, não. Metade do
    // critério que o M31 existe para cumprir.
    //
    // Este teste trava o vocabulário: reintroduzir `'lexical'` como perna conhecida não o faz
    // passar, porque nenhuma asserção aqui usa esse nome. O que ele impede é o oposto —
    // REMOVER `'keyword'` do reconhecimento volta a produzir o fallback e reprova.
    expect(legLabel([{ leg: 'lexical', rank: 1 }])).toBe('origin not reported');
  });
});

describe('discoveryRows', () => {
  // A forma foi MEDIDA no app-dev em 2026-08-04, não inferida do domínio: o handler devolve
  // `results` (não `skills`) e `matched` como `[{leg, rank}]` (não `string[]`). A primeira versão
  // desta projeção assumiu a forma do `hybrid-retriever.ts` e lia campos que não existem — a tela
  // mostrava "0 resultados" com o serviço devolvendo dois.
  const payload: RetrievePayload = {
    results: [
      { skill_id: 'sk_b', name: 'B', description: 'd', score: 0.4, matched: [{ leg: 'keyword', rank: 1 }] },
      {
        skill_id: 'sk_a',
        name: 'A',
        description: 'd',
        score: 0.9,
        matched: [
          { leg: 'keyword', rank: 1 },
          { leg: 'vector', rank: 2 },
        ],
      },
    ],
  };

  it('ordena do maior score para o menor — quem lê quer o topo', () => {
    expect(discoveryRows(payload).map((r) => r.skillId)).toEqual(['sk_a', 'sk_b']);
  });

  it('empate desempata por identificador, para a ordem não dançar entre buscas', () => {
    const rows = discoveryRows({
      results: [
        { skill_id: 'sk_z', name: 'Z', description: '', score: 0.5, matched: [{ leg: 'vector', rank: 1 }] },
        { skill_id: 'sk_a', name: 'A', description: '', score: 0.5, matched: [{ leg: 'vector', rank: 1 }] },
      ],
    });
    expect(rows.map((r) => r.skillId)).toEqual(['sk_a', 'sk_z']);
  });

  it('cada linha carrega a frase da perna, não o nome do módulo', () => {
    const [primeira] = discoveryRows(payload);
    expect(primeira?.legText).toBe('words and intent');
  });

  it('score ausente vira null, não zero — são frases diferentes', () => {
    // `0` afirma "casou muito mal". `null` admite "o registro não informou". Um registro mais
    // antigo pode não devolver score, e inventar zero classificaria a skill como péssima.
    const [linha] = discoveryRows({
      results: [{ skill_id: 'sk_a', name: 'A', description: '', matched: [{ leg: 'keyword', rank: 1 }] } as never],
    });
    expect(linha?.score).toBeNull();
  });

  it('payload ausente devolve lista vazia sem lançar', () => {
    expect(discoveryRows(null)).toEqual([]);
    expect(discoveryRows(undefined)).toEqual([]);
    expect(discoveryRows({} as RetrievePayload)).toEqual([]);
  });
});
