// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { variableFields, renderTemplate, textVariables } from './preview';

/**
 * M12 T2 — o preview de render, FORA do React.
 *
 * Duas invariantes que o resto da tela depende:
 *  - os campos vêm de `variables`, que a API DECLARA por revisão — nunca de um regex nosso
 *    sobre o texto. Adivinhar seria inventar dado que o serviço não afirmou;
 *  - renderizar é substituição local e determinística. NENHUMA chamada a modelo. O eixo de
 *    custo fecha por construção, não por disciplina de quem lê o código depois.
 */
describe('camposDeVariaveis', () => {
  it('preview_fields_come_from_the_api_variables_not_from_parsing', () => {
    // O texto menciona {{time}}, mas a API declarou só `nome`. Manda quem declarou.
    const campos = variableFields(['nome'], 'Olá {{nome}}, do time {{time}}');
    expect(Object.keys(campos)).toEqual(['nome']);
  });

  it('preview_renders_one_field_per_variable_even_when_repeated', () => {
    // `variables` já vem deduplicado e na ordem da 1ª aparição (medido contra a API).
    // Este caso trava a invariante contra alguém "melhorar" isto com um regex próprio.
    const campos = variableFields(['nome', 'time'], 'Olá {{nome}}, {{nome}} de novo e {{time}}');
    expect(Object.keys(campos)).toEqual(['nome', 'time']);
  });

  it('preview_has_no_fields_when_the_api_declares_none', () => {
    expect(variableFields([], 'texto sem variável')).toEqual({});
  });
});

describe('renderTemplate', () => {
  it('preview_substitutes_the_filled_values', () => {
    expect(renderTemplate('Olá {{nome}}!', { nome: 'Paulo' })).toBe('Olá Paulo!');
  });

  it('preview_substitutes_every_occurrence_of_the_same_variable', () => {
    expect(renderTemplate('{{n}} e {{n}}', { n: 'x' })).toBe('x e x');
  });

  it('preview_shows_the_unfilled_placeholder_verbatim', () => {
    // Campo vazio ⇒ o marcador PERMANECE. Apagá-lo esconderia do operador que existe um buraco
    // no que o modelo receberia — o preview mentiria por omissão.
    expect(renderTemplate('Olá {{nome}}!', { nome: '' })).toBe('Olá {{nome}}!');
  });

  it('preview_leaves_a_variable_the_api_did_not_declare_untouched', () => {
    expect(renderTemplate('{{a}} {{b}}', { a: 'A' })).toBe('A {{b}}');
  });

  it('preview_does_not_treat_the_value_as_a_template', () => {
    // Valor que parece marcador não pode disparar segunda substituição — seria injeção de
    // template a partir de entrada do operador.
    expect(renderTemplate('{{a}}', { a: '{{b}}', b: 'X' })).toBe('{{b}}');
  });
});

describe('variaveisDoTexto — a única derivação nossa, e por isso testada aqui', () => {
  it('extracted_variables_are_deduped_and_in_first_appearance_order', () => {
    // O mesmo contrato que a API cumpre (medido). Se divergir, o preview mostraria um campo
    // que a substituição não preenche.
    expect(textVariables('{{b}} e {{a}} e {{b}} de novo')).toEqual(['b', 'a']);
  });

  it('extracted_variables_tolerate_inner_spaces_like_the_service_does', () => {
    expect(textVariables('{{ nome }}')).toEqual(['nome']);
  });

  it('extraction_and_substitution_agree_on_what_a_marker_is', () => {
    // O par que impede a divergência: tudo que a extração acha, a substituição preenche.
    const texto = 'Olá {{ nome }}, do {{time}}. {{1invalido}} não conta.';
    const achadas = textVariables(texto);
    const valores = Object.fromEntries(achadas.map((v) => [v, 'X']));
    const renderizado = renderTemplate(texto, valores);
    for (const v of achadas) {
      expect(renderizado, `${v} continuou como marcador`).not.toContain(`{{${v}}}`);
    }
    expect(renderizado).toContain('{{1invalido}}');
  });
});
