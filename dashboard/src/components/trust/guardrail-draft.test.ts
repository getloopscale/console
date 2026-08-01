import { describe, expect, it } from 'vitest';

import {
  EMPTY_DRAFT,
  cleanTerms,
  draftProblems,
  toCreateBody,
  toTestBody,
  verdictSummary,
  type GuardrailDraft,
} from './guardrail-draft';

/**
 * M24 T2.1 — a lógica que decide se um rascunho pode virar produção.
 *
 * O peso deste arquivo não é o de um formulário: o objeto que ele valida passa a BLOQUEAR
 * conversa real do tenant. As decisões travadas aqui (só `ban-list`, nome reservado recusado
 * antes da ida ao servidor, termo em branco recusado) foram tomadas com razão registrada no
 * cabeçalho do módulo; sem teste elas se perdem no próximo refactor.
 */

const draft = (over: Partial<GuardrailDraft> = {}): GuardrailDraft => ({ ...EMPTY_DRAFT, ...over });

describe('draftProblems', () => {
  it('recusa rascunho vazio', () => {
    expect(draftProblems(EMPTY_DRAFT)).not.toHaveLength(0);
  });

  it('exige nome', () => {
    const problems = draftProblems(draft({ terms: ['segredo'] }));
    expect(problems).toContain('Dê um nome à guardrail.');
  });

  it('exige ao menos um termo', () => {
    const problems = draftProblems(draft({ name: 'sem-termos' }));
    expect(problems).toContain('Adicione ao menos um termo a bloquear.');
  });

  it('recusa nome reservado da plataforma antes de ir ao servidor', () => {
    // O serviço devolveria 422 VALIDATOR_NAME_RESERVED — mas só depois de uma ida ao servidor,
    // com o operador já tendo perdido o contexto do campo. A autoridade continua sendo o 422.
    const problems = draftProblems(draft({ name: 'pii', terms: ['x'] }));
    expect(problems.some((p) => p.includes('reservado'))).toBe(true);
  });

  it('recusa nome reservado independentemente de caixa', () => {
    expect(draftProblems(draft({ name: 'PII', terms: ['x'] })).some((p) => p.includes('reservado'))).toBe(true);
  });

  it('exige replacement quando a ação é modify', () => {
    const problems = draftProblems(draft({ name: 'n', terms: ['x'], action: 'modify', replacement: '  ' }));
    expect(problems).toContain('Defina o texto que substitui o termo encontrado.');
  });

  it('não exige replacement quando a ação é block', () => {
    expect(draftProblems(draft({ name: 'n', terms: ['x'], action: 'block', replacement: '' }))).toHaveLength(0);
  });

  it('aceita o menor rascunho válido — um único termo', () => {
    expect(draftProblems(draft({ name: 'n', terms: ['segredo'] }))).toHaveLength(0);
  });
});

describe('cleanTerms', () => {
  it('remove brancos das bordas', () => {
    expect(cleanTerms(['  segredo  '])).toEqual(['segredo']);
  });

  it('descarta duplicata sem diferenciar caixa, preservando a ordem digitada', () => {
    expect(cleanTerms(['Alpha', 'beta', 'ALPHA'])).toEqual(['Alpha', 'beta']);
  });

  it('descarta termo vazio', () => {
    expect(cleanTerms(['', '   ', 'x'])).toEqual(['x']);
  });

  it('devolve lista vazia para entrada vazia', () => {
    expect(cleanTerms([])).toEqual([]);
  });
});

describe('toCreateBody', () => {
  it('envia sempre kind ban-list — o único que o operador escolhe', () => {
    // Decisão de produto registrada no módulo: `regex-match` convida a um padrão catastrófico,
    // `moderation` responde 422 neste deploy, e os demais já vêm ligados como padrão de plataforma.
    const body = toCreateBody(draft({ name: 'n', terms: ['x'] })) as { spec: { kind: string } };
    expect(body.spec.kind).toBe('ban-list');
  });

  it('omite replacement quando a ação é block', () => {
    const body = toCreateBody(draft({ name: 'n', terms: ['x'], action: 'block' })) as { spec: Record<string, unknown> };
    // Mandá-lo em `block` seria um campo ignorado sugerindo comportamento que não existe.
    expect('replacement' in body.spec).toBe(false);
  });

  it('inclui replacement quando a ação é modify', () => {
    const body = toCreateBody(
      draft({ name: 'n', terms: ['x'], action: 'modify', replacement: ' [oculto] ' }),
    ) as { spec: Record<string, unknown> };
    expect(body.spec.replacement).toBe('[oculto]');
  });

  it('normaliza os termos antes de enviar', () => {
    const body = toCreateBody(draft({ name: ' n ', terms: [' a ', 'a', 'b'] })) as {
      name: string;
      spec: { terms: string[] };
    };
    expect(body.name).toBe('n');
    expect(body.spec.terms).toEqual(['a', 'b']);
  });
});

describe('toTestBody', () => {
  it('testa exatamente a spec que seria gravada', () => {
    // Se o dry-run testasse uma spec diferente da que grava, o passo obrigatório de teste seria
    // teatro: o operador aprovaria A e o serviço receberia B.
    const d = draft({ name: 'n', terms: ['x'], action: 'modify', replacement: 'z' });
    const created = toCreateBody(d) as { spec: unknown };
    const tested = toTestBody(d, 'uma amostra') as { spec: unknown; content: string };

    expect(tested.spec).toEqual(created.spec);
    expect(tested.content).toBe('uma amostra');
  });
});

describe('verdictSummary', () => {
  it('fala no futuro do pretérito — o dry-run não alterou nada', () => {
    // Dizer "bloqueado" faria o operador acreditar que a regra já está valendo.
    expect(verdictSummary({ action: 'block' })).toBe('Esta mensagem seria bloqueada.');
  });

  it('mostra o texto reescrito quando há modificação', () => {
    expect(verdictSummary({ action: 'modify', modified: 'oi [redigido]' })).toContain('oi [redigido]');
  });

  it('diz claramente quando a regra não alcança a mensagem', () => {
    expect(verdictSummary({ action: 'allow' })).toContain('passaria');
  });

  it('devolve null para veredito ausente ou desconhecido', () => {
    expect(verdictSummary(null)).toBeNull();
    expect(verdictSummary(undefined)).toBeNull();
    expect(verdictSummary({})).toBeNull();
    expect(verdictSummary({ action: 'algo-que-nao-existe' })).toBeNull();
  });
});
