import { describe, it, expect } from 'vitest';

import { summarizeConsumption, type ConsumptionRow } from './usage-summary';

/**
 * As 4 linhas MEDIDAS no app-dev em 2026-08-03. Fixture inventado não exercitaria as duas pontas de
 * `formatCost` nem a razão de cache real (1.964:1), que é justamente o que dá sentido ao KPI.
 */
const LINHAS: ConsumptionRow[] = [
  { userId: '90fff2496804', spans: 49373, inputTokens: 3261202, outputTokens: 12590407, cacheReadTokens: 6405653920, cacheCreationTokens: 111933070, costUsd: 4179.475464 },
  { userId: 'unattributed', spans: 3, inputTokens: 11716, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 },
  { userId: 'agent-builder-qa', spans: 1, inputTokens: 5725, outputTokens: 133, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 },
  { userId: 'b08873a43f7f', spans: 2, inputTokens: 10, outputTokens: 57, cacheReadTokens: 17585, cacheCreationTokens: 25583, costUsd: 0.034032 },
];

describe('resumirConsumo', () => {
  it('soma custo e tokens das linhas exibidas', () => {
    const r = summarizeConsumption(LINHAS, 4);
    expect(r.costUsd).toBeCloseTo(4179.509496, 6);
    // entrada + saída de todas as linhas — cache NÃO entra aqui, é outra grandeza
    expect(r.tokens).toBe(3261202 + 12590407 + 11716 + 0 + 5725 + 133 + 10 + 57);
  });

  it('deriva o percentual de cache das DUAS pontas, não só da leitura', () => {
    const r = summarizeConsumption(LINHAS, 4);
    // 6.405.671.505 de cache contra 3.278.653 de entrada fresca
    expect(r.cacheRatio).not.toBeNull();
    expect(r.cacheRatio!).toBeGreaterThan(0.999);
    expect(r.cacheRatio!).toBeLessThan(1);
  });

  // "não usou cache" e "não sabemos" são fatos diferentes. Um `0%` afirma o primeiro sobre o segundo.
  it('devolve null — nunca zero — quando não há leitura de cache alguma', () => {
    const semCache = LINHAS.map((l) => ({ ...l, cacheReadTokens: 0 }));
    expect(summarizeConsumption(semCache, 4).cacheRatio).toBeNull();
  });

  it('declara escopo COMPLETO quando as linhas exibidas cobrem todos os usuários', () => {
    expect(summarizeConsumption(LINHAS, 4).completo).toBe(true);
  });

  it('declara escopo PARCIAL quando há mais usuários do que linhas exibidas', () => {
    expect(summarizeConsumption(LINHAS, 400).completo).toBe(false);
  });

  it('as participações das linhas somam 1', () => {
    const r = summarizeConsumption(LINHAS, 4);
    // `reduce<number>` explícito: sem ele o acumulador herda `number | null` do próprio array.
    const soma = r.participacoes.reduce<number>((a, p) => a + (p ?? 0), 0);
    expect(soma).toBeCloseTo(1, 9);
  });

  it('a participação segue a ordem de consumo — o maior tem a maior fatia', () => {
    const r = summarizeConsumption(LINHAS, 4);
    expect(r.participacoes[0]!).toBeGreaterThan(0.99);
    expect(r.participacoes[1]).toBe(0); // custo zero é fatia zero, não null
  });

  // Divisão por zero: sem custo algum, nenhuma fatia é afirmável — nem 0%, nem NaN.
  it('devolve participações nulas quando o custo somado é zero', () => {
    const semCusto = LINHAS.map((l) => ({ ...l, costUsd: 0 }));
    const r = summarizeConsumption(semCusto, 4);
    expect(r.participacoes.every((p) => p === null)).toBe(true);
    expect(r.costUsd).toBe(0);
  });

  it('resume uma lista vazia sem estourar', () => {
    const r = summarizeConsumption([], 0);
    expect(r.costUsd).toBe(0);
    expect(r.tokens).toBe(0);
    expect(r.cacheRatio).toBeNull();
    expect(r.participacoes).toEqual([]);
    expect(r.completo).toBe(true);
  });
});
