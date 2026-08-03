import { describe, it, expect } from 'vitest';
import { diffLines, DIFF_LINE_CEILING } from './diff';

/**
 * M12 T1 — o diff entre duas revisões.
 *
 * O trio dos três primeiros casos é o que discrimina, e só junto: o primeiro passa numa
 * implementação que normaliza TUDO e nunca mostra nada; o terceiro passa numa que não normaliza
 * NADA. Os dois primeiros sozinhos aprovariam um diff que apaga mudança real — que é o defeito
 * que o adendo de discovery mandou evitar, porque um diff que mostra ruído (ou que esconde
 * mudança) ensina o operador a ignorá-lo.
 */
describe('diffLines — normalização', () => {
  it('diff_identical_content_has_zero_changed_blocks', () => {
    const blocos = diffLines('linha um\nlinha dois', 'linha um\nlinha dois');
    expect(blocos.filter((b) => b.kind !== 'same')).toEqual([]);
  });

  it('diff_ignores_crlf_vs_lf', () => {
    // Mesmo conteúdo, editor diferente. Não é mudança.
    const blocos = diffLines('linha um\r\nlinha dois', 'linha um\nlinha dois');
    expect(blocos.filter((b) => b.kind !== 'same')).toEqual([]);
  });

  it('diff_does_not_ignore_a_space_inside_the_line', () => {
    // Num prompt, um espaço a mais depois de {{nome}} muda o que o modelo recebe.
    const blocos = diffLines('Olá {{nome}}, tudo bem?', 'Olá {{nome}},  tudo bem?');
    expect(blocos.filter((b) => b.kind === 'removed')).toHaveLength(1);
    expect(blocos.filter((b) => b.kind === 'added')).toHaveLength(1);
  });

  it('diff_ignores_trailing_whitespace_at_end_of_line', () => {
    const blocos = diffLines('uma linha   \noutra', 'uma linha\noutra');
    expect(blocos.filter((b) => b.kind !== 'same')).toEqual([]);
  });
});

describe('diffLines — o que mudou', () => {
  it('diff_marks_an_added_line_as_added', () => {
    const blocos = diffLines('a\nc', 'a\nb\nc');
    expect(blocos.filter((b) => b.kind === 'added').map((b) => b.text)).toEqual(['b']);
    expect(blocos.filter((b) => b.kind === 'removed')).toEqual([]);
  });

  it('diff_marks_a_removed_line_as_removed', () => {
    const blocos = diffLines('a\nb\nc', 'a\nc');
    expect(blocos.filter((b) => b.kind === 'removed').map((b) => b.text)).toEqual(['b']);
    expect(blocos.filter((b) => b.kind === 'added')).toEqual([]);
  });

  it('diff_preserves_the_original_line_order', () => {
    const blocos = diffLines('a\nb', 'a\nx\nb');
    expect(blocos.map((b) => b.text)).toEqual(['a', 'x', 'b']);
  });

  it('diff_of_empty_against_content_is_all_added', () => {
    const blocos = diffLines('', 'nova');
    expect(blocos.filter((b) => b.kind === 'added').map((b) => b.text)).toEqual(['nova']);
  });
});

describe('diffLines — teto de tamanho (EC-3)', () => {
  it('diff_refuses_to_compare_content_over_the_line_ceiling', () => {
    // `content` não tem `.max()` na API (medido). LCS é O(n·m): duas revisões grandes travam
    // a aba. Recusar e DIZER é honesto; truncar em silêncio entregaria comparação incompleta
    // com cara de completa.
    const gigante = Array.from({ length: DIFF_LINE_CEILING + 1 }, (_, i) => `l${i}`).join('\n');
    const blocos = diffLines(gigante, `${gigante}\nmais`);
    // O número é o do LADO MAIOR (a revisão nova, com uma linha a mais), não a soma dos dois:
    // a soma não corresponde a nada que o operador tenha na mão.
    expect(blocos).toEqual([
      { kind: 'too-large', text: `${DIFF_LINE_CEILING + 2} linhas — acima do teto de ${DIFF_LINE_CEILING}` },
    ]);
  });

  it('diff_at_exactly_the_ceiling_still_compares', () => {
    // A fronteira pertence ao lado que funciona — senão o teto vira um muro silencioso.
    const noLimite = Array.from({ length: DIFF_LINE_CEILING }, (_, i) => `l${i}`).join('\n');
    const blocos = diffLines(noLimite, noLimite);
    expect(blocos.every((b) => b.kind === 'same')).toBe(true);
  });
});
