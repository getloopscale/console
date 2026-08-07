import { describe, it, expect } from 'vitest';
import { toSeries, totalInWindow, violationCount, byPolicy, peakSeverity, coverageGap, unenforcedCount, conversationMessages, filterByPolicy } from './trust-series';

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

describe('coverageGap — a distância entre observado e bloqueado', () => {
  const violations = {
    violations: [
      { policy: 'credential_leak' }, { policy: 'credential_leak' }, { policy: 'credential_leak' },
      { policy: 'pii_exposure' }, { policy: 'pii_exposure' },
      { policy: 'prohibited_content' },
    ],
  };

  it('marca como enforced apenas o que tem guardrail no catalogo', () => {
    const got = coverageGap(violations, { validators: [{ policy: 'pii_exposure' }] });
    expect(got.find((c) => c.policy === 'pii_exposure')?.enforced).toBe(true);
    expect(got.find((c) => c.policy === 'credential_leak')?.enforced).toBe(false);
  });

  it('o DESCOBERTO vem primeiro, e dentro dele o mais frequente', () => {
    // A linha de cima e sempre a decisao mais urgente. Ordenar por frequencia apenas colocaria
    // credential_leak no topo mesmo se ele ja estivesse bloqueado — enterrando o risco real.
    const got = coverageGap(violations, { validators: [{ policy: 'credential_leak' }] });
    expect(got.map((c) => c.policy)).toEqual(['pii_exposure', 'prohibited_content', 'credential_leak']);
  });

  it('sem catalogo, tudo conta como descoberto — nao como coberto', () => {
    // Falha ao ler o catalogo NAO pode virar "esta tudo bloqueado": seria o falso negativo
    // exato que esta tela existe para eliminar.
    expect(coverageGap(violations, null).every((c) => !c.enforced)).toBe(true);
  });

  it('aceita `items` alem de `validators` como nome da lista', () => {
    expect(coverageGap(violations, { items: [{ policy: 'pii_exposure' }] })
      .find((c) => c.policy === 'pii_exposure')?.enforced).toBe(true);
  });

  it('cai para `category` quando o validator nao declara `policy`', () => {
    expect(coverageGap(violations, { validators: [{ category: 'credential_leak' }] })
      .find((c) => c.policy === 'credential_leak')?.enforced).toBe(true);
  });

  it('unenforcedCount conta o que ainda passa', () => {
    expect(unenforcedCount(coverageGap(violations, { validators: [{ policy: 'pii_exposure' }] }))).toBe(2);
    expect(unenforcedCount(coverageGap(violations, {
      validators: [{ policy: 'credential_leak' }, { policy: 'pii_exposure' }, { policy: 'prohibited_content' }],
    }))).toBe(0);
  });
});

describe('conversationMessages', () => {
  it('extrai as mensagens legiveis', () => {
    expect(conversationMessages({ messages: [
      { id: 'm1', role: 'user', content: 'oi' },
      { id: 'm2', role: 'assistant', content: 'ola' },
    ]})).toHaveLength(2);
  });

  it('descarta mensagem sem conteudo em vez de renderizar "undefined"', () => {
    expect(conversationMessages({ messages: [{ id: 'm1', role: 'user' }, { id: 'm2', content: '' }] }))
      .toEqual([]);
  });

  it('sobrevive a payload nulo ou sem messages', () => {
    expect(conversationMessages(null)).toEqual([]);
    expect(conversationMessages({})).toEqual([]);
    expect(conversationMessages({ messages: 'nope' } as never)).toEqual([]);
  });
});

describe('filterByPolicy', () => {
  const violations = [
    { id: 'a', policy: 'credential_leak' },
    { id: 'b', policy: 'pii_exposure' },
    { id: 'c', policy: 'credential_leak' },
  ];

  it('devolve so as violacoes da politica pedida', () => {
    // `/trust` promete "revisar ESTA politica"; devolver a lista inteira quebra a promessa
    // em silencio — o operador nao ve erro, so uma lista que nao corresponde ao que clicou.
    expect(filterByPolicy(violations, 'credential_leak').map((v) => v.id)).toEqual(['a', 'c']);
  });

  it('devolve tudo quando nao ha filtro — a rota tambem e alcancavel direto', () => {
    expect(filterByPolicy(violations, null)).toHaveLength(3);
    expect(filterByPolicy(violations, undefined)).toHaveLength(3);
    expect(filterByPolicy(violations, '')).toHaveLength(3);
  });

  it('devolve lista vazia quando a politica nao aparece', () => {
    expect(filterByPolicy(violations, 'nao-existe')).toEqual([]);
  });

  it('nao muta a lista recebida', () => {
    const out = filterByPolicy(violations, null);
    out.push({ id: 'z' });
    expect(violations).toHaveLength(3);
  });
});
