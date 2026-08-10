import { describe, expect, it } from 'vitest';

import {
  EMPTY_DRAFT,
  cleanTerms,
  draftProblems,
  toCreateBody,
  toTestBody,
  verdictSummary,
  draftProblemsByField,
  visibleFieldProblems,
  type DraftField,
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
    expect(problems.map((p) => p.mensagem)).toContain('Give the guardrail a name.');
  });

  it('exige ao menos um termo', () => {
    const problems = draftProblems(draft({ name: 'sem-termos' }));
    expect(problems.map((p) => p.mensagem)).toContain('Add at least one term to block.');
  });

  it('recusa nome reservado da plataforma antes de ir ao servidor', () => {
    // O serviço devolveria 422 VALIDATOR_NAME_RESERVED — mas só depois de uma ida ao servidor,
    // com o operador já tendo perdido o contexto do campo. A autoridade continua sendo o 422.
    const problems = draftProblems(draft({ name: 'pii', terms: ['x'] }));
    expect(problems.some((p) => p.campo === 'name' && p.mensagem.includes('reserved'))).toBe(true);
  });

  it('recusa nome reservado independentemente de caixa', () => {
    expect(draftProblems(draft({ name: 'PII', terms: ['x'] })).some((p) => p.campo === 'name' && p.mensagem.includes('reserved'))).toBe(true);
  });

  it('exige replacement quando a ação é modify', () => {
    const problems = draftProblems(draft({ name: 'n', terms: ['x'], action: 'modify', replacement: '  ' }));
    expect(problems.map((p) => p.mensagem)).toContain('Set the text that replaces the term found.');
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
    expect(verdictSummary({ action: 'block' })).toBe('This message would be blocked.');
  });

  it('mostra o texto reescrito quando há modificação', () => {
    expect(verdictSummary({ action: 'modify', modified: 'oi [redigido]' })).toContain('oi [redigido]');
  });

  it('diz claramente quando a regra não alcança a mensagem', () => {
    expect(verdictSummary({ action: 'allow' })).toContain('would pass');
  });

  it('devolve null para veredito ausente ou desconhecido', () => {
    expect(verdictSummary(null)).toBeNull();
    expect(verdictSummary(undefined)).toBeNull();
    expect(verdictSummary({})).toBeNull();
    expect(verdictSummary({ action: 'algo-que-nao-existe' })).toBeNull();
  });
});

describe('draftProblemsByField', () => {
  it('endereça o problema ao campo que o causou', () => {
    // Sem isto, a frase aparece no rodapé e o operador adivinha qual campo corrigir.
    const byField = draftProblemsByField(EMPTY_DRAFT);
    expect(byField.name).toContain('name');
    expect(byField.terms).toContain('term');
  });

  it('aponta o nome reservado para o campo de nome', () => {
    const byField = draftProblemsByField(draft({ name: 'pii', terms: ['x'] }));
    expect(byField.name).toContain('reserved');
    expect(byField.terms).toBeUndefined();
  });

  it('aponta o replacement ausente para o próprio campo', () => {
    const byField = draftProblemsByField(
      draft({ name: 'n', terms: ['x'], action: 'modify', replacement: '  ' }),
    );
    expect(byField.replacement).toBeDefined();
    expect(byField.name).toBeUndefined();
  });

  it('não reporta campo algum num rascunho válido', () => {
    expect(draftProblemsByField(draft({ name: 'n', terms: ['x'] }))).toEqual({});
  });
});

describe('visibleFieldProblems', () => {
  it('cala sobre campo que o operador ainda não visitou', () => {
    // Um formulário que abre acusando campos vazios transforma a tela de partida numa tela de
    // erro, e ensina a ignorar o vermelho justamente onde ele vai importar.
    expect(visibleFieldProblems(EMPTY_DRAFT, new Set())).toEqual({});
  });

  it('reporta apenas o campo visitado', () => {
    const visible = visibleFieldProblems(EMPTY_DRAFT, new Set<DraftField>(['name']));

    expect(visible.name).toContain('name');
    expect(visible.terms).toBeUndefined();
  });

  it('não inventa problema para campo visitado e válido', () => {
    const valid = draft({ name: 'n', terms: ['x'] });

    expect(visibleFieldProblems(valid, new Set<DraftField>(['name', 'terms']))).toEqual({});
  });
});

describe('o campo de cada problema é DADO, não deduzido da frase (B-111)', () => {
  /**
   * O defeito que este bloco fecha, e como ele apareceu.
   *
   * `draftProblemsByField` decidia a qual campo cada problema pertencia lendo a MENSAGEM
   * HUMANA — `problem.includes('nome')`, `includes('termo')`, `includes('substitui')`.
   * Funcionava, e era uma armadilha: em 2026-08-10 a tradução do painel para inglês (B-109)
   * trocou todas as frases e o roteador parou de casar qualquer uma. O modo de falha foi o
   * pior possível — **silencioso**: a lista de problemas seguia correta, só a associação com
   * o campo sumia, então a tela dizia "há um erro" sem dizer ONDE.
   *
   * A ordem dos `if` também era carga: `replaces` tinha de ser checado ANTES de `term`,
   * porque a frase do replacement contém a palavra "term". Uma regra de precedência entre
   * substrings de texto de interface é uma bomba com o pino já puxado — qualquer reescrita
   * de mensagem, inclusive por clareza, a detona.
   *
   * O conserto é de categoria: o campo passa a viajar COM o problema.
   */
  it('cada problema declara o campo a que pertence', () => {
    const problemas = draftProblems(draft({ name: '', terms: [] }));

    expect(problemas.length).toBeGreaterThan(0);
    for (const p of problemas) {
      expect(
        p,
        'um problema sem `campo` volta a obrigar alguém a adivinhar pelo texto',
      ).toHaveProperty('campo');
      expect(['name', 'terms', 'replacement']).toContain(p.campo);
    }
  });

  it('o problema do replacement vai para o replacement — mesmo citando "term" na frase', () => {
    // O caso que a precedência entre substrings existia para salvar, agora afirmado como
    // contrato. A mensagem é "Set the text that replaces the term found": sob roteamento por
    // substring, checar `term` antes de `replaces` a manda para o campo errado.
    //
    // Com o campo vindo como dado, nenhuma ordem importa e nenhuma reescrita da frase muda o
    // destino. Este caso falha se alguém voltar a deduzir o campo do texto.
    const porCampo = draftProblemsByField(
      draft({ name: 'ok', terms: ['x'], action: 'modify', replacement: '' }),
    );

    expect(porCampo.replacement).toMatch(/replaces/i);
    expect(porCampo.terms, 'a frase do replacement vazou para o campo de termos').toBeUndefined();
  });
});
