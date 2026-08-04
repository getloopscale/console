import { describe, it, expect } from 'vitest';
import { projetarUso, type AgregadoDeUso } from './usage';

/**
 * M15 — a projeção que sabe o que NÃO sabe.
 *
 * O DoD-3 do milestone é uma regra de projeção, não de render: *"um período sem
 * dado é dito como tal"*. O M13 provou que essa distinção é onde a tela mente com
 * mais facilidade — um zero renderizado sobre uma leitura que falhou é
 * indistinguível de um zero verdadeiro, e leva o operador à conclusão oposta.
 *
 * Três estados, deliberadamente distintos: tem uso · não teve uso na janela ·
 * não consegui ler.
 */

const REVISOES = [6, 5, 4];

describe('projetarUso — os três estados', () => {
  it('revisao com uso projeta chamadas e custo', () => {
    const agregado: AgregadoDeUso = {
      estado: 'lido',
      rows: [{ revision: 6, resolutions: 12, totalTokens: 1500, costUsd: 0.031, p50LatencyMs: 4.2 }],
    };

    const linhas = projetarUso(agregado, REVISOES);

    // O DoD-2 do ROADMAP pede QUATRO números por revisão, não dois.
    expect(linhas[0]).toMatchObject({
      revision: 6,
      estado: 'com-uso',
      chamadas: 12,
      tokens: 1500,
      custoUsd: 0.031,
      latenciaP50Ms: 4.2,
    });
  });

  it('revisao SEM uso na janela projeta sem-chamadas, que nao e zero', () => {
    const agregado: AgregadoDeUso = { estado: 'lido', rows: [] };

    const linhas = projetarUso(agregado, REVISOES);

    expect(linhas[0]?.estado).toBe('sem-chamadas');
    // O oráculo que importa: a projeção não pode oferecer um `0` para a tela renderizar.
    expect(linhas[0]?.chamadas).toBeUndefined();
  });

  it('agregado em ERRO projeta nao-lido, e nenhum zero (DoD-3)', () => {
    const agregado: AgregadoDeUso = { estado: 'nao-lido', razao: 'o serviço não respondeu' };

    const linhas = projetarUso(agregado, REVISOES);

    expect(linhas.every((l) => l.estado === 'nao-lido')).toBe(true);
    expect(linhas[0]?.razao).toMatch(/não respondeu/);
    // Nenhum número de contagem pode existir no resultado — nem como 0.
    expect(linhas.some((l) => l.chamadas !== undefined)).toBe(false);
    expect(linhas.some((l) => l.custoUsd !== undefined)).toBe(false);
  });

  it('custo ausente fica vazio COM RAZAO, nunca estimado (DoD-4)', () => {
    const agregado: AgregadoDeUso = {
      estado: 'lido',
      rows: [{ revision: 6, resolutions: 12, totalTokens: 1500, costUsd: null, p50LatencyMs: null }],
    };

    const linhas = projetarUso(agregado, REVISOES);

    expect(linhas[0]?.chamadas).toBe(12);
    expect(linhas[0]?.custoUsd).toBeUndefined();
    expect(linhas[0]?.razaoDoCusto).toMatch(/.+/);
  });

  it('o controle que da sentido ao anterior: custo presente aparece intacto', () => {
    const agregado: AgregadoDeUso = {
      estado: 'lido',
      rows: [{ revision: 6, resolutions: 1, totalTokens: 10, costUsd: 0.0004, p50LatencyMs: null }],
    };

    const linhas = projetarUso(agregado, REVISOES);

    expect(linhas[0]?.custoUsd).toBe(0.0004);
    expect(linhas[0]?.razaoDoCusto).toBeUndefined();
  });

  it('custo ZERO sem tokens NAO e um custo medido — e o defeito que a aceitacao pegou', () => {
    // Medido no app-dev: o `theo-lens` escreve `traces.cost_usd = 0` para um trace sem
    // chamada de modelo. A soma devolve 0, e a tela renderizava "US$ 0.0000" — afirmando
    // um custo medido onde nao houve medicao. O operador le "barato"; a verdade e "nenhuma
    // chamada de modelo compartilhou o trace desta resolucao" (o limite do ADR-1).
    const agregado: AgregadoDeUso = {
      estado: 'lido',
      rows: [{ revision: 14, resolutions: 1, totalTokens: 0, costUsd: 0, p50LatencyMs: null }],
    };

    const linhas = projetarUso(agregado, [14]);

    expect(linhas[0]?.chamadas).toBe(1);
    expect(linhas[0]?.custoUsd, 'zero sem tokens virou custo medido').toBeUndefined();
    expect(linhas[0]?.razaoDoCusto).toMatch(/.+/);
  });

  it('custo zero COM tokens e um custo medido de verdade — o controle', () => {
    // Um modelo gratuito existe. Sem este par, a correcao acima poderia descartar
    // qualquer zero, inclusive um medido.
    const agregado: AgregadoDeUso = {
      estado: 'lido',
      rows: [{ revision: 14, resolutions: 1, totalTokens: 350, costUsd: 0, p50LatencyMs: null }],
    };

    const linhas = projetarUso(agregado, [14]);

    expect(linhas[0]?.custoUsd).toBe(0);
    expect(linhas[0]?.razaoDoCusto).toBeUndefined();
  });

  it('revisao que o agregado nao conhece nao vira linha fantasma', () => {
    // O agregado só devolve revisões que tiveram tráfego. A lista de revisões é a
    // fonte da ordem e da completude — o agregado só a enriquece.
    const agregado: AgregadoDeUso = {
      estado: 'lido',
      rows: [
        { revision: 6, resolutions: 3, totalTokens: 10, costUsd: 0.01, p50LatencyMs: 1 },
        { revision: 99, resolutions: 1000, totalTokens: 1, costUsd: 9.99, p50LatencyMs: 2 },
      ],
    };

    const linhas = projetarUso(agregado, REVISOES);

    expect(linhas.map((l) => l.revision)).toEqual(REVISOES);
  });
});
