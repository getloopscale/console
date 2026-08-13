// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  throughputSeries,
  errorRateSeries,
  latencySeries,
  latencyPercentileBuckets,
  costByModelSeries,
  tokensByModelSeries,
  scoresToSeries,
} from './lens-series';

describe('scoresToSeries (M90 — score over time)', () => {
  it('one series per numeric evaluator over the shared sorted period axis', () => {
    const series = scoresToSeries([
      { periodStart: '2026-07-08T00:00:00.000Z', name: 'hallucination', sampleCount: 2, avgScore: 0.3, labels: {} },
      { periodStart: '2026-07-08T01:00:00.000Z', name: 'hallucination', sampleCount: 1, avgScore: 0.8, labels: {} },
      { periodStart: '2026-07-08T00:00:00.000Z', name: 'relevance', sampleCount: 1, avgScore: 0.9, labels: {} },
    ]);
    const byName = Object.fromEntries(series.map((s) => [s.name, s]));
    expect(Object.keys(byName).sort()).toEqual(['hallucination', 'relevance']);
    // hallucination has both buckets, sorted ascending by period index
    expect(byName['hallucination']!.points).toEqual([
      { x: 0, y: 0.3 },
      { x: 1, y: 0.8 },
    ]);
    // `relevance` só tem amostra no primeiro período. O comentário desta linha SEMPRE disse "a
    // gap, NOT a fabricated 0" — e a asserção antiga (`[{ x: 0, y: 0.9 }]`, um ponto só) codificava
    // OMISSÃO, não lacuna. As duas coisas parecem iguais e não são: o `seriesPath` só quebra a
    // linha onde encontra um `y` não-finito, e uma entrada ausente ele nunca vê. O resultado era a
    // linha desenhada por cima do período sem amostra — afirmando continuidade que o dado não tem.
    //
    // A crença falsa estava registrada por escrito, ao lado de uma asserção que a contradizia. Foi
    // assim que o defeito sobreviveu dentro do verde (`usetheoai/theo-cloud#395`).
    expect(byName['relevance']!.points).toHaveLength(2);
    expect(byName['relevance']!.points[0]).toEqual({ x: 0, y: 0.9 });
    expect(byName['relevance']!.points[1]?.x).toBe(1);
    expect(Number.isFinite(byName['relevance']!.points[1]?.y)).toBe(false);
  });

  it('drops a categorical-only evaluator (no avgScore) from the mean chart', () => {
    const series = scoresToSeries([
      { periodStart: 'a', name: 'tone', sampleCount: 3, labels: { warm: 3 } }, // no avgScore
      { periodStart: 'a', name: 'quality', sampleCount: 1, avgScore: 0.5, labels: {} },
    ]);
    expect(series.map((s) => s.name)).toEqual(['quality']); // tone dropped — nothing to plot on a mean axis
  });

  it('an all-categorical (or empty) input yields no series (honest empty, not a zero line)', () => {
    expect(scoresToSeries([])).toEqual([]);
    expect(scoresToSeries([{ periodStart: 'a', name: 'tone', sampleCount: 1, labels: { x: 1 } }])).toEqual([]);
  });
});

describe('lens-series mappers (M51)', () => {
  it('throughputSeries: one series over the buckets', () => {
    const s = throughputSeries([
      { periodStart: 'a', traceCount: 8, errorCount: 2, errorRate: 0.25 },
      { periodStart: 'b', traceCount: 2, errorCount: 0, errorRate: 0 },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].points).toEqual([{ x: 0, y: 8 }, { x: 1, y: 2 }]);
  });

  it('errorRateSeries: a %-line straight from the pre-computed errorRate (no re-derivation)', () => {
    const s = errorRateSeries([{ periodStart: 'a', traceCount: 8, errorCount: 2, errorRate: 0.25 }]);
    expect(s[0].points).toEqual([{ x: 0, y: 25 }]);
  });

  it('latencySeries: p50/p95/p99 overlaid as three series', () => {
    const s = latencySeries([{ periodStart: 'a', p50Ms: 10, p95Ms: 90, p99Ms: 120 }]);
    expect(s.map((x) => x.name)).toEqual(['p50', 'p95', 'p99']);
    expect(s[2].points[0]).toEqual({ x: 0, y: 120 });
  });
});

describe('latencyPercentileBuckets (M11 — latency band)', () => {
  it('maps each LatencyBucket to a PercentileBucket carrying p50/p95/p99', () => {
    const out = latencyPercentileBuckets([
      { periodStart: '2026-07-07T09:30:00Z', p50Ms: 100, p95Ms: 400, p99Ms: 800 },
      { periodStart: '2026-07-07T10:00:00Z', p50Ms: 90, p95Ms: 350, p99Ms: 700 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ p50: 100, p95: 400, p99: 800 });
    expect(out[1]).toMatchObject({ p50: 90, p95: 350, p99: 700 });
  });

  it('derives a short HH:MM label from a parseable periodStart', () => {
    const out = latencyPercentileBuckets([{ periodStart: '2026-07-07T09:30:00Z', p50Ms: 1, p95Ms: 2, p99Ms: 3 }]);
    // a wall-clock HH:MM label read in the a11y table (locale-agnostic 24h)
    expect(out[0].label).toMatch(/^\d{2}:\d{2}$/);
  });

  it('falls back to the raw periodStart when it is not a parseable date (never fabricates a time)', () => {
    const out = latencyPercentileBuckets([{ periodStart: 'bucket-1', p50Ms: 1, p95Ms: 2, p99Ms: 3 }]);
    expect(out[0].label).toBe('bucket-1');
  });

  it('empty input → no buckets (honest empty, the component owns the empty state)', () => {
    expect(latencyPercentileBuckets([])).toEqual([]);
  });
});

describe('lens-series mappers (M51) — continued', () => {
  it('costByModelSeries: one series per model over a shared bucket axis', () => {
    const s = costByModelSeries([
      { periodStart: 'a', model: 'opus', totalTokens: 1, costUsd: 0.5 },
      { periodStart: 'b', model: 'opus', totalTokens: 1, costUsd: 0.7 },
      { periodStart: 'a', model: 'haiku', totalTokens: 1, costUsd: 0.1 },
    ]);
    const opus = s.find((x) => x.name === 'opus');
    const haiku = s.find((x) => x.name === 'haiku');
    expect(opus?.points).toEqual([{ x: 0, y: 0.5 }, { x: 1, y: 0.7 }]);
    expect(haiku?.points).toEqual([{ x: 0, y: 0.1 }, { x: 1, y: 0 }]); // zero-filled for the missing bucket
  });

  it('costByModelSeries: collapses beyond topN models into an "Others" series', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      periodStart: 'a',
      model: `m${i}`,
      totalTokens: 1,
      costUsd: 8 - i, // m0 most expensive … m7 least
    }));
    const s = costByModelSeries(rows, 5);
    expect(s.map((x) => x.name)).toContain('Others');
    // top 5 named models + 1 Others = 6 series
    expect(s).toHaveLength(6);
    // Others aggregates m5+m6+m7 = 3+2+1 = 6 in bucket 0
    expect(s.find((x) => x.name === 'Others')?.points[0].y).toBe(6);
  });

  it('costByModelSeries: empty input → no series', () => {
    expect(costByModelSeries([])).toEqual([]);
  });

  it('tokensByModelSeries: plots totalTokens, NOT cost (#178)', () => {
    const rows = [
      { periodStart: 'a', model: 'gpt-4', totalTokens: 900, costUsd: 0.03 },
      { periodStart: 'a', model: 'claude', totalTokens: 500, costUsd: 0.07 },
    ];
    const s = tokensByModelSeries(rows);
    // The y-values are the TOKEN sums, not the cost sums — the whole point of #178.
    expect(s.find((x) => x.name === 'gpt-4')?.points[0].y).toBe(900);
    expect(s.find((x) => x.name === 'claude')?.points[0].y).toBe(500);
    // ...and distinct from what costByModelSeries would plot for the same rows.
    const c = costByModelSeries(rows);
    expect(c.find((x) => x.name === 'gpt-4')?.points[0].y).toBe(0.03);
  });

  it('tokensByModelSeries: ranks top-N by tokens and collapses the rest into Others', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      periodStart: 'a',
      model: `m${i}`,
      totalTokens: 8 - i, // m0 most tokens … m7 least
      costUsd: 1,
    }));
    const s = tokensByModelSeries(rows, 5);
    expect(s.map((x) => x.name)).toContain('Others');
    expect(s).toHaveLength(6);
    // Others aggregates m5+m6+m7 tokens = 3+2+1 = 6
    expect(s.find((x) => x.name === 'Others')?.points[0].y).toBe(6);
  });

  it('tokensByModelSeries: empty input → no series', () => {
    expect(tokensByModelSeries([])).toEqual([]);
  });
});

/**
 * M147 — a convenção de lacuna, travada como INVARIANTE e não caso a caso.
 *
 * O produto expressava lacuna de três formas: `NaN` (usage-by-user, M144), omissão de entrada
 * (`scoresToSeries`) e zero fabricado no eixo (`byModelSeries`). O `seriesPath` só entende a
 * primeira, então as outras duas desenhavam por cima do buraco.
 *
 * Este teste existe no lugar de uma constante compartilhada. Uma constante não pega o próximo
 * autor; um teste que falha, sim — e a convenção que precisa ser preservada é de uma palavra
 * (`NaN` é o token de lacuna), imposta pelo contrato do `seriesPath`, que já é o ponto único de
 * verdade.
 */
describe('a convenção de lacuna (M147)', () => {
  it('scoresToSeries: período sem amostra vira slot NÃO-FINITO, nunca entrada ausente', () => {
    const buckets = [
      { periodStart: '2026-07-20T00:00:00Z', name: 'a', sampleCount: 5, avgScore: 0.5, labels: {} },
      { periodStart: '2026-07-21T00:00:00Z', name: 'b', sampleCount: 5, avgScore: 0.7, labels: {} },
      { periodStart: '2026-07-22T00:00:00Z', name: 'a', sampleCount: 5, avgScore: 0.9, labels: {} },
    ];
    const [serieA] = scoresToSeries(buckets).filter((s) => s.name === 'a');
    // três períodos no eixo, e `a` não pontuou no do meio
    expect(serieA?.points).toHaveLength(3);
    expect(Number.isFinite(serieA?.points[1]?.y)).toBe(false);
    // …e NÃO é zero: uma média sobre zero amostras é indefinida, não zero.
    expect(serieA?.points[1]?.y).not.toBe(0);
  });

  it('toda série de scoresToSeries cobre o eixo inteiro — comprimentos iguais', () => {
    // Séries de comprimentos diferentes é o sintoma da omissão: o `x` salta e o eixo encolhe.
    const buckets = [
      { periodStart: '2026-07-20T00:00:00Z', name: 'a', sampleCount: 5, avgScore: 0.5, labels: {} },
      { periodStart: '2026-07-21T00:00:00Z', name: 'b', sampleCount: 5, avgScore: 0.7, labels: {} },
      { periodStart: '2026-07-22T00:00:00Z', name: 'c', sampleCount: 5, avgScore: 0.9, labels: {} },
    ];
    const tamanhos = new Set(scoresToSeries(buckets).map((s) => s.points.length));
    expect(tamanhos.size).toBe(1);
    expect([...tamanhos][0]).toBe(3);
  });
});
