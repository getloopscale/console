import { describe, expect, it } from 'vitest';

import { filtrarAcervo, mesclarPaginas, type SkillLinha } from './paging';

/**
 * M31 — acervo que aguenta escala.
 *
 * O defeito medido: `next_page_token` estava **tipado e não usado**, então acima do teto de uma
 * página o excedente sumia **sem erro algum** — a tela dizia "12 no acervo" com 300 lá dentro.
 *
 * O filtro é sobre o que está CARREGADO, e a tela precisa dizer isso. Um filtro que parece varrer
 * o acervo inteiro e varre uma página é pior que filtro nenhum: leva o operador a concluir que a
 * skill não existe.
 */

const linha = (id: string, nome = id, desc = ''): SkillLinha => ({
  skill_id: id,
  name: nome,
  description: desc,
  state: 'live',
  latest_revision_id: null,
});

describe('mesclarPaginas', () => {
  it('concatena na ordem em que as páginas chegaram', () => {
    const r = mesclarPaginas([linha('a'), linha('b')], [linha('c')]);
    expect(r.map((s) => s.skill_id)).toEqual(['a', 'b', 'c']);
  });

  it('NÃO duplica quando a mesma página chega duas vezes', () => {
    // Um clique duplo em "carregar mais", ou um refetch do React Query, entregaria a mesma
    // página de novo. Duplicar faria a contagem mentir e a `key` do React colidir.
    const r = mesclarPaginas([linha('a'), linha('b')], [linha('b'), linha('c')]);
    expect(r.map((s) => s.skill_id)).toEqual(['a', 'b', 'c']);
  });

  it('a versão mais recente de uma skill vence a antiga', () => {
    // Entre uma página e outra a skill pode ter sido editada. Manter a primeira exibiria dado
    // velho ao lado de dado novo, sem nada indicando qual é qual.
    const r = mesclarPaginas([linha('a', 'nome antigo')], [linha('a', 'nome novo')]);
    expect(r).toHaveLength(1);
    expect(r[0]?.name).toBe('nome novo');
  });

  it('página vazia não muda nada', () => {
    expect(mesclarPaginas([linha('a')], [])).toHaveLength(1);
    expect(mesclarPaginas([], [])).toEqual([]);
  });
});

describe('filtrarAcervo', () => {
  const acervo = [
    linha('sk_pr', 'Revisar pull request', 'Lê o diff e aponta riscos'),
    linha('sk_cambio', 'Converter moeda', 'Cotação do dia'),
  ];

  it('filtro vazio devolve tudo — não é "nenhum resultado"', () => {
    expect(filtrarAcervo(acervo, '')).toHaveLength(2);
    expect(filtrarAcervo(acervo, '   ')).toHaveLength(2);
  });

  it('casa por nome, sem diferenciar maiúsculas', () => {
    expect(filtrarAcervo(acervo, 'MOEDA').map((s) => s.skill_id)).toEqual(['sk_cambio']);
  });

  it('casa por descrição — o operador lembra do que a skill FAZ, não do nome', () => {
    expect(filtrarAcervo(acervo, 'diff').map((s) => s.skill_id)).toEqual(['sk_pr']);
  });

  it('casa por identificador — é o que aparece em log e em erro', () => {
    expect(filtrarAcervo(acervo, 'sk_cambio').map((s) => s.skill_id)).toEqual(['sk_cambio']);
  });

  it('ignora acento, porque quem digita rápido não acentua', () => {
    // "cotacao" tem de achar "Cotação". Sem isso o filtro parece quebrado para quem escreve
    // sem acento — que é a maioria de quem está com pressa.
    expect(filtrarAcervo(acervo, 'cotacao').map((s) => s.skill_id)).toEqual(['sk_cambio']);
    expect(filtrarAcervo(acervo, 'COTAÇÃO').map((s) => s.skill_id)).toEqual(['sk_cambio']);
  });

  it('nada casando devolve lista vazia, não o acervo inteiro', () => {
    expect(filtrarAcervo(acervo, 'inexistente')).toEqual([]);
  });
});
