// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { SLO, sloTone } from './slo-tones';

describe('B-194 — um SLO, uma resposta', () => {
  it.each([
    [99.95, 'success'], [99.9, 'success'], [99.5, 'warning'], [99.0, 'warning'], [98.9, 'destructive'],
  ] as const)('uptime %s → %s', (v, esperado) => {
    expect(sloTone(v, SLO.uptime)).toBe(esperado);
  });

  it.each([
    [120, 'success'], [499, 'success'], [500, 'warning'], [999, 'warning'], [1000, 'destructive'],
  ] as const)('p95 %sms → %s', (v, esperado) => {
    expect(sloTone(v, SLO.p95LatencyMs)).toBe(esperado);
  });

  it.each([
    [0, 'success'], [0.9, 'success'], [1, 'warning'], [4.9, 'warning'], [5, 'destructive'],
  ] as const)('error rate %s%% → %s', (v, esperado) => {
    expect(sloTone(v, SLO.errorRatePct)).toBe(esperado);
  });

  it('o que não foi medido fica muted, e não vermelho', () => {
    // Não ter medido não é ter medido mal. Pintar de vermelho o que não se sabe é a mesma
    // afirmação falsa que esta varredura remove das listas e dos gráficos.
    for (const faixa of Object.values(SLO)) {
      expect(sloTone(null, faixa)).toBe('muted');
      expect(sloTone(undefined, faixa)).toBe('muted');
      expect(sloTone(Number.NaN, faixa)).toBe('muted');
      expect(sloTone(Number.POSITIVE_INFINITY, faixa)).toBe('muted');
    }
  });
});
