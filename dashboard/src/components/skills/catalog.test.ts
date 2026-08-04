import { describe, expect, it } from 'vitest';

import { catalogCards, categoryChips, type CatalogSkill } from './catalog';

/**
 * M33 — o catálogo, para quem NÃO SABE o que existe.
 *
 * A projeção é compartilhada com a tabela do M31 de propósito: o risco #1 declarado no roadmap é
 * card e tabela divergirem — um filtro que existe num e não no outro faz o mesmo acervo parecer
 * dois.
 */

const sk = (id: string, over: Partial<CatalogSkill> = {}): CatalogSkill => ({
  skill_id: id,
  name: id,
  description: 'd',
  state: 'live',
  latest_revision_id: 'rev',
  ...over,
});

describe('catalogCards', () => {
  it('ordena por nome, com desempate por identificador', () => {
    // Determinístico porque o servidor pode devolver em qualquer ordem, e uma grade que dança
    // entre recargas parece instável sem nada ter mudado. O desempate é o que torna a ordem
    // reproduzível quando dois nomes colidem.
    const cards = catalogCards([
      sk('sk_z', { name: 'Alfa' }),
      sk('sk_a', { name: 'Alfa' }),
      sk('sk_m', { name: 'Beta' }),
    ]);
    expect(cards.map((c) => c.skillId)).toEqual(['sk_a', 'sk_z', 'sk_m']);
  });

  it('a ordenação ignora acento e caixa — senão "Ãgil" cai depois de "Zulu"', () => {
    const cards = catalogCards([sk('b', { name: 'zulu' }), sk('a', { name: 'Ágil' })]);
    expect(cards.map((c) => c.skillId)).toEqual(['a', 'b']);
  });

  it('descobrível é `embedded === true` — e ausente NÃO conta como descobrível', () => {
    // Um registro que não devolve o campo não afirmou que a skill tem vetor. Tratar ausência
    // como `true` faria a tela prometer descoberta que pode não existir.
    expect(catalogCards([sk('a', { embedded: true })])[0]?.discoverable).toBe(true);
    expect(catalogCards([sk('a', { embedded: false })])[0]?.discoverable).toBe(false);
    expect(catalogCards([sk('a')])[0]?.discoverable).toBe(false);
  });

  it('visibilidade ausente vira "não informada", nunca um valor inventado', () => {
    expect(catalogCards([sk('a')])[0]?.visibilityText).toBe('não informada');
    expect(catalogCards([sk('a', { visibility: 'private' })])[0]?.visibilityText).toBe('privada');
    expect(catalogCards([sk('a', { visibility: 'public' })])[0]?.visibilityText).toBe('pública');
  });

  it('uma visibilidade que a tela não conhece atravessa como veio', () => {
    // Um registro mais novo pode inventar `internal`. Traduzi-la para "privada" ou "pública"
    // afirmaria algo falso sobre quem enxerga a skill.
    expect(catalogCards([sk('a', { visibility: 'internal' })])[0]?.visibilityText).toBe('internal');
  });

  it('lista ausente devolve vazio sem lançar', () => {
    expect(catalogCards(null)).toEqual([]);
    expect(catalogCards(undefined)).toEqual([]);
  });
});

describe('categoryChips', () => {
  const acervo = [
    sk('a', { category: 'engenharia' }),
    sk('b', { category: 'finance' }),
    sk('c', { category: 'engenharia' }),
    sk('d', { category: 'suporte' }),
    sk('e', { category: 'dados' }),
  ];

  it('devolve categorias ÚNICAS, ordenadas, sem contagem', () => {
    // SEM contagem por decisão do roadmap: derivada da página carregada, ela afirmaria sobre o
    // ACERVO um número que só vale para o que está na tela.
    const chips = categoryChips(acervo, 10);
    expect(chips.visiveis).toEqual(['dados', 'engenharia', 'finance', 'suporte']);
    expect(chips.excedente).toBe(0);
  });

  it('respeita o teto e reporta o excedente como número', () => {
    const chips = categoryChips(acervo, 2);
    expect(chips.visiveis).toEqual(['dados', 'engenharia']);
    // `+2` é quantas categorias ficaram de fora — não quantas skills.
    expect(chips.excedente).toBe(2);
  });

  it('categoria ausente não vira chip vazio', () => {
    // Um chip em branco parece defeito de renderização, e clicar nele filtraria por "".
    const chips = categoryChips([sk('a'), sk('b', { category: '' }), sk('c', { category: 'x' })], 10);
    expect(chips.visiveis).toEqual(['x']);
  });

  it('teto zero ou negativo não quebra — devolve nada visível e tudo no excedente', () => {
    expect(categoryChips(acervo, 0).visiveis).toEqual([]);
    expect(categoryChips(acervo, 0).excedente).toBe(4);
  });
});
