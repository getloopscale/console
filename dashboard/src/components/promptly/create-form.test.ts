import { describe, it, expect } from 'vitest';
import { validarCriacao, fraseDePermanencia } from './create-form';

describe('validarCriacao (EC-4)', () => {
  it('create_form_rejects_a_name_outside_the_safe_charset', () => {
    // Medido: POST aceita 'time/saudacao' (201) mas o GET só responde com %2F, e há dois
    // intermediários cujo tratamento de barra codificada NÃO foi medido. Sem DELETE no produto,
    // um nome ilegível fica no histórico para sempre.
    const r = validarCriacao('time/saudacao');
    expect(r.ok).toBe(false);
    expect(r.erroNome).toContain('Barras');
  });

  it('create_form_rejects_a_name_with_spaces', () => {
    expect(validarCriacao('meu prompt').ok).toBe(false);
  });

  it('create_form_rejects_an_empty_name', () => {
    expect(validarCriacao('   ').ok).toBe(false);
  });

  it('create_form_accepts_the_conventional_name_shape', () => {
    // O par: restringir sem aceitar o que o time de fato usa seria trocar um problema por outro.
    for (const nome of ['saudacao', 'onboarding.welcome', 'faq-v2', 'resumo_curto']) {
      expect(validarCriacao(nome).ok, nome).toBe(true);
    }
  });
});

describe('fraseDePermanencia', () => {
  it('create_form_states_the_revision_is_permanent', () => {
    const f = fraseDePermanencia(true, 5);
    expect(f).toContain('v5');
    expect(f).toMatch(/imutáveis/i);
    expect(f).toMatch(/não há como editar nem apagar/i);
  });

  it('create_form_distinguishes_a_brand_new_prompt_from_a_new_revision', () => {
    expect(fraseDePermanencia(false, 1)).toContain('prompt novo');
    expect(fraseDePermanencia(true, 2)).toContain('já existem');
  });
});
