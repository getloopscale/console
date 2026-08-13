import { describe, it, expect } from 'vitest';
import { validarCriacao, fraseDePermanencia } from './create-form';

describe('validarCriacao — a descrição da mudança (M17)', () => {
  it('descricao vazia REPROVA — a obrigacao e da tela, nao da API', () => {
    // ADR-3: a API aceita ausente para não quebrar automação; quem DECIDE está aqui.
    // Um campo opcional num formulário é um campo vazio, e o milestone inteiro
    // deixaria de acontecer.
    const r = validarCriacao({ name: 'saudacao', description: '' });

    expect(r.ok).toBe(false);
    expect(r.descriptionError).toMatch(/.+/);
  });

  it('descricao so de espacos REPROVA — a borda que um trim descuidado deixa passar', () => {
    const r = validarCriacao({ name: 'saudacao', description: '    ' });

    expect(r.ok).toBe(false);
    expect(r.descriptionError).toMatch(/.+/);
  });

  it('descricao acima do teto REPROVA, e o teto e dito', () => {
    const r = validarCriacao({ name: 'saudacao', description: 'x'.repeat(501) });

    expect(r.ok).toBe(false);
    expect(r.descriptionError).toMatch(/500/);
  });

  it('exatamente no teto PASSA — a outra borda', () => {
    const r = validarCriacao({ name: 'saudacao', description: 'x'.repeat(500) });

    expect(r.ok).toBe(true);
    expect(r.descriptionError).toBeNull();
  });

  it('nome invalido E descricao vazia reportam os DOIS erros', () => {
    // Reportar um de cada vez faria o operador corrigir, submeter, e descobrir o
    // segundo — duas viagens para um formulário de dois campos.
    const r = validarCriacao({ name: 'time/saudacao', description: '' });

    expect(r.nameError).toMatch(/.+/);
    expect(r.descriptionError).toMatch(/.+/);
  });

  it('descricao valida com nome valido APROVA', () => {
    const r = validarCriacao({ name: 'saudacao', description: 'encurtei o preambulo' });

    expect(r).toEqual({ ok: true, nameError: null, descriptionError: null });
  });
});

describe('validarCriacao (EC-4)', () => {
  it('create_form_rejects_a_name_outside_the_safe_charset', () => {
    // Medido: POST aceita 'time/saudacao' (201) mas o GET só responde com %2F, e há dois
    // intermediários cujo tratamento de barra codificada NÃO foi medido. Sem DELETE no produto,
    // um nome ilegível fica no histórico para sempre.
    const r = validarCriacao({ name: 'time/saudacao', description: 'x' });
    expect(r.ok).toBe(false);
    expect(r.nameError).toContain('Slashes');
  });

  it('create_form_rejects_a_name_with_spaces', () => {
    expect(validarCriacao({ name: 'meu prompt', description: 'x' }).ok).toBe(false);
  });

  it('create_form_rejects_an_empty_name', () => {
    expect(validarCriacao({ name: '   ', description: 'x' }).ok).toBe(false);
  });

  it('create_form_accepts_the_conventional_name_shape', () => {
    // O par: restringir sem aceitar o que o time de fato usa seria trocar um problema por outro.
    for (const name of ['saudacao', 'onboarding.welcome', 'faq-v2', 'resumo_curto']) {
      expect(validarCriacao({ name, description: 'x' }).ok, name).toBe(true);
    }
  });
});

describe('fraseDePermanencia', () => {
  it('create_form_states_the_revision_is_permanent', () => {
    const f = fraseDePermanencia(true, 5);
    expect(f).toContain('v5');
    expect(f).toMatch(/immutable/i);
    expect(f).toMatch(/no editing or deleting/i);
  });

  it('create_form_distinguishes_a_brand_new_prompt_from_a_new_revision', () => {
    expect(fraseDePermanencia(false, 1)).toContain('a new prompt');
    expect(fraseDePermanencia(true, 2)).toContain('already exist');
  });
});
