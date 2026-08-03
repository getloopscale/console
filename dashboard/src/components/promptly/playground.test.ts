import { describe, it, expect } from 'vitest';

import { ApiError } from '@/lib/api';

import { camposDeVariaveis, podeRodar, classificarFalha } from './playground';

/**
 * M14 T3.1 — a lógica que decide se um botão FATURÁVEL está habilitado, e como
 * uma falha é lida pelo operador.
 *
 * Fora do React de propósito, como as cinco irmãs (`projections`, `diff`,
 * `preview`, `rollback`, `create-form`): dentro de um componente, estas regras só
 * seriam alcançáveis por render, e uma regra que gasta dinheiro do operador
 * merece teste em milissegundos.
 */
describe('camposDeVariaveis — DoD-2: os campos vêm do que a API DECLARA', () => {
  it('deriva exatamente um campo por variavel declarada, na ordem de declaracao', () => {
    expect(camposDeVariaveis(['topico', 'artigo'], []).map((c) => c.nome)).toEqual([
      'topico',
      'artigo',
    ]);
  });

  it('prompt sem variavel alguma nao produz campo algum', () => {
    expect(camposDeVariaveis([], [])).toEqual([]);
  });

  /**
   * Trocar de prompt re-deriva. Preservar o valor da variável que sobreviveu é o
   * que impede o operador de redigitar tudo ao comparar dois prompts parecidos;
   * descartar a que sumiu é o que impede um valor órfão de viajar no corpo.
   */
  it('ao trocar de prompt, descarta a variavel que sumiu e preserva o valor da que ficou', () => {
    const antes = [
      { nome: 'topico', valor: 'chuva' },
      { nome: 'antiga', valor: 'x' },
    ];

    expect(camposDeVariaveis(['topico', 'nova'], antes)).toEqual([
      { nome: 'topico', valor: 'chuva' },
      { nome: 'nova', valor: '' },
    ]);
  });

  it('a ordem segue a DECLARACAO, nao a ordem do que ja estava digitado', () => {
    const antes = [
      { nome: 'b', valor: '2' },
      { nome: 'a', valor: '1' },
    ];

    expect(camposDeVariaveis(['a', 'b'], antes).map((c) => c.nome)).toEqual(['a', 'b']);
  });
});

describe('podeRodar — DoD-5: não dá para gastar sem preencher', () => {
  it('e falso quando qualquer variavel esta vazia', () => {
    expect(podeRodar([{ nome: 'topico', valor: '' }], 'sk-x')).toBe(false);
  });

  /**
   * Só espaços conta como vazio. É o mesmo julgamento que o serviço faz
   * (`trim()`), e ter os dois lados concordando evita o pior desfecho possível:
   * o botão habilitado, a chamada saindo, e o serviço recusando depois — com o
   * operador achando que gastou.
   */
  it('e falso quando a variavel tem so espacos', () => {
    expect(podeRodar([{ nome: 'topico', valor: '   ' }], 'sk-x')).toBe(false);
  });

  it('e falso sem credencial', () => {
    expect(podeRodar([{ nome: 'topico', valor: 'chuva' }], '')).toBe(false);
  });

  it('e verdadeiro com tudo preenchido', () => {
    expect(podeRodar([{ nome: 'topico', valor: 'chuva' }], 'sk-x')).toBe(true);
  });

  it('prompt sem variavel alguma pode rodar so com a credencial', () => {
    expect(podeRodar([], 'sk-x')).toBe(true);
  });
});

/**
 * Os status vêm do que `cloudFetch` DE FATO produz — medido em `src/lib/api.ts`,
 * não suposto. Ele nunca deixa passar um `TypeError`: rede caída vira
 * `ApiError(0)` (`api.ts:360`), excesso vira `ApiError(429)` (`:238`, `:325`) e
 * sessão expirada vira `ApiError(401)` (`:334`).
 */
describe('classificarFalha — DoD-5: o motivo do provider, ou o genérico honesto', () => {
  it.each([
    [
      'recusa do provider',
      new ApiError(422, { error: 'model_refused', providerStatus: 401, message: 'chave inválida' }),
      'provider',
    ],
    ['variavel faltante', new ApiError(400, { error: 'missing_variable', variable: 'topico' }), 'validacao'],
    ['template malformado', new ApiError(400, { error: 'invalid_template', reason: 'chaves' }), 'validacao'],
    ['rede caiu', new ApiError(0, undefined), 'transporte'],
    ['servico fora', new ApiError(502, { error: 'promptly_unavailable' }), 'transporte'],
    ['bug nosso', new ApiError(500, { error: 'internal_error' }), 'transporte'],
    ['rate limit NOSSO', new ApiError(429, undefined), 'transporte'],
    ['corpo grande demais', new ApiError(413, undefined), 'validacao'],
    ['sessao expirada', new ApiError(401, undefined), 'sessao'],
  ])('classifica %s como %s', (_nome, erro, tipo) => {
    expect(classificarFalha(erro).tipo).toBe(tipo);
  });

  it('preserva a mensagem tipada do servico no caso provider', () => {
    const f = classificarFalha(
      new ApiError(422, { error: 'model_refused', providerStatus: 401, message: 'chave inválida' }),
    );

    expect(f).toMatchObject({ tipo: 'provider', mensagem: 'chave inválida', providerStatus: 401 });
  });

  it('nomeia a variavel faltante, para a tela poder apontar o campo', () => {
    const f = classificarFalha(new ApiError(400, { error: 'missing_variable', variable: 'artigo' }));

    expect(f).toMatchObject({ tipo: 'validacao', variavelFaltante: 'artigo' });
  });

  /**
   * O controle que impede a classificação de virar invenção: sem corpo, não há
   * mensagem a preservar nem status de provider a afirmar.
   */
  it('NUNCA inventa mensagem nem providerStatus quando nao ha corpo', () => {
    const f = classificarFalha(new ApiError(0, undefined));

    expect(f.tipo).toBe('transporte');
    expect(JSON.stringify(f)).not.toContain('providerStatus');
  });

  /**
   * O 429 NOSSO é rate limit do plano de controle; a quota do provider chega como
   * 422 com `providerStatus: 429`. Confundir os dois diria ao operador para trocar
   * a chave quando o problema é nosso.
   */
  it('separa o 429 NOSSO da quota do provider, que vem como 422', () => {
    expect(classificarFalha(new ApiError(429, undefined)).tipo).toBe('transporte');

    const quotaDoProvider = classificarFalha(
      new ApiError(422, { error: 'model_refused', providerStatus: 429 }),
    );
    expect(quotaDoProvider).toMatchObject({ tipo: 'provider', providerStatus: 429 });
  });

  /** M14 pós-review (M2): 413 dizia "não foi possível falar com o serviço". */
  it('o 413 diz que o prompt e grande demais, nao que a rede caiu', () => {
    const f = classificarFalha(new ApiError(413, undefined));

    expect(f).toMatchObject({ tipo: 'validacao' });
    expect((f as { motivo?: string }).motivo).toMatch(/grande demais/i);
  });

  it('um erro que nao e ApiError cai em transporte, sem estourar', () => {
    expect(classificarFalha(new Error('qualquer coisa')).tipo).toBe('transporte');
    expect(classificarFalha(undefined).tipo).toBe('transporte');
  });
});
