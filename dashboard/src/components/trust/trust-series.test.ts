import { describe, it, expect } from 'vitest';
import { toSeries, totalInWindow, violationCount, byPolicy, peakSeverity } from './trust-series';

describe('toSeries', () => {
  it('projeta baldes bem formados', () => {
    expect(toSeries({ buckets: [{ bucket: '2026-07-30', total: 2 }, { bucket: '2026-07-31', total: 5 }] }))
      .toEqual([{ label: '2026-07-30', value: 2 }, { label: '2026-07-31', value: 5 }]);
  });

  it('descarta o balde sem total numerico em vez de coagir para zero', () => {
    // Coagir desenharia um vale que nunca existiu, e o operador leria queda de violacoes onde
    // houve lacuna de dados.
    const got = toSeries({ buckets: [{ bucket: 'a', total: 3 }, { bucket: 'b' }, { bucket: 'c', total: 1 }] });
    expect(got).toEqual([{ label: 'a', value: 3 }, { label: 'c', value: 1 }]);
  });

  it('descarta NaN e Infinity, que renderizariam como eixo quebrado', () => {
    expect(toSeries({ buckets: [{ bucket: 'a', total: NaN }, { bucket: 'b', total: Infinity }] })).toEqual([]);
  });

  it('sobrevive a payload ausente, nulo ou com buckets nao-array', () => {
    expect(toSeries(null)).toEqual([]);
    expect(toSeries(undefined)).toEqual([]);
    expect(toSeries({})).toEqual([]);
    expect(toSeries({ buckets: 'nope' } as never)).toEqual([]);
  });
});

describe('totalInWindow', () => {
  it('soma a janela', () => {
    expect(totalInWindow({ buckets: [{ bucket: 'a', total: 2 }, { bucket: 'b', total: 3 }] })).toBe(5);
  });

  it('devolve null — e NUNCA zero — quando nao ha serie', () => {
    // "zero violacoes" e "nao sei quantas violacoes" levam a decisoes opostas num painel de
    // seguranca. O segundo disfarcado do primeiro e um falso negativo.
    expect(totalInWindow(null)).toBeNull();
    expect(totalInWindow({ buckets: [] })).toBeNull();
  });

  it('soma zero legitimo continua sendo zero, nao null', () => {
    expect(totalInWindow({ buckets: [{ bucket: 'a', total: 0 }] })).toBe(0);
  });
});

describe('violationCount', () => {
  it('conta as linhas', () => {
    expect(violationCount({ violations: [{ id: '1' }, { id: '2' }] })).toBe(2);
  });

  it('lista vazia e zero; payload invalido e null', () => {
    expect(violationCount({ violations: [] })).toBe(0);
    expect(violationCount(null)).toBeNull();
    expect(violationCount({})).toBeNull();
  });
});

describe('byPolicy', () => {
  it('agrupa e ordena da mais frequente para a menos', () => {
    expect(byPolicy({ violations: [
      { policy: 'pii_exposure' }, { policy: 'credential_leak' }, { policy: 'pii_exposure' },
    ]})).toEqual([{ label: 'pii_exposure', value: 2 }, { label: 'credential_leak', value: 1 }]);
  });

  it('desempata alfabeticamente para o render ser deterministico', () => {
    // Sem isso a ordem depende da iteracao do objeto e duas cargas iguais desenham linhas trocadas.
    expect(byPolicy({ violations: [{ policy: 'zeta' }, { policy: 'alpha' }] }))
      .toEqual([{ label: 'alpha', value: 1 }, { label: 'zeta', value: 1 }]);
  });

  it('linha sem politica vira "desconhecida" em vez de sumir da contagem', () => {
    expect(byPolicy({ violations: [{ policy: '' }, {}] })).toEqual([{ label: 'desconhecida', value: 2 }]);
  });
});

describe('peakSeverity', () => {
  it('usa a ordem do dominio, nao a alfabetica', () => {
    // Alfabeticamente "medium" > "high" > "critical" — a ordem errada faria o painel reportar
    // severidade menor do que a real.
    expect(peakSeverity({ violations: [{ severity: 'medium' }, { severity: 'critical' }, { severity: 'high' }] }))
      .toBe('critical');
  });

  it('e insensivel a caixa', () => {
    expect(peakSeverity({ violations: [{ severity: 'HIGH' }] })).toBe('high');
  });

  it('null quando nao ha linha, ou quando nenhuma severidade e reconhecida', () => {
    expect(peakSeverity({ violations: [] })).toBeNull();
    expect(peakSeverity(null)).toBeNull();
    expect(peakSeverity({ violations: [{ severity: 'inventada' }] })).toBeNull();
  });
});
