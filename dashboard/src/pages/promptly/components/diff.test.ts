// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { diffLines, diffConfig, DIFF_LINE_CEILING } from './diff';

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
      { kind: 'too-large', text: `${DIFF_LINE_CEILING + 2} lines — above the ceiling of ${DIFF_LINE_CEILING}` },
    ]);
  });

  it('diff_at_exactly_the_ceiling_still_compares', () => {
    // A fronteira pertence ao lado que funciona — senão o teto vira um muro silencioso.
    const noLimite = Array.from({ length: DIFF_LINE_CEILING }, (_, i) => `l${i}`).join('\n');
    const blocos = diffLines(noLimite, noLimite);
    expect(blocos.every((b) => b.kind === 'same')).toBe(true);
  });
});

describe('diffConfig — a config muda, não só o texto (M17 DoD-4)', () => {
  it('mesmo texto e temperaturas DIFERENTES sao diferentes', () => {
    // O bullet do ROADMAP, literal: "duas revisões com o mesmo texto e temperaturas
    // diferentes aparecem como diferentes no comparador".
    const d = diffConfig({ temperature: 0.2 }, { temperature: 0.9 });

    expect(d.mudou).toBe(true);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ field: 'temperature', before: '0.2', after: '0.9' });
  });

  it('mesma config NAO e diferenca — o controle que da sentido ao caso acima', () => {
    const d = diffConfig({ temperature: 0.2, model: 'gpt-4o' }, { temperature: 0.2, model: 'gpt-4o' });

    expect(d.mudou).toBe(false);
    expect(d.rows).toHaveLength(0);
  });

  it('mesmas chaves em ORDEM diferente nao e diferenca', () => {
    // EC-6: a comparação é por campo, não por serialização — senão a ordem das chaves
    // acusaria mudança onde não houve.
    const d = diffConfig({ temperature: 0.2, model: 'a' }, { model: 'a', temperature: 0.2 });

    expect(d.mudou).toBe(false);
  });

  it('uma revisao COM config e outra sem: a ausencia e dita, nao mostrada como vazio', () => {
    const d = diffConfig(null, { temperature: 0.5 });

    expect(d.mudou).toBe(true);
    expect(d.rows[0]?.before).toMatch(/before the config/i);
  });

  it('as DUAS sem config nao e diferenca', () => {
    expect(diffConfig(null, null).mudou).toBe(false);
  });

  it('temperature 0 vs ausente E diferenca — 0 nao e o mesmo que nao ter', () => {
    const d = diffConfig({ temperature: 0 }, null);

    expect(d.mudou).toBe(true);
  });

  it('temperature 0 vs 0 nao e diferenca', () => {
    expect(diffConfig({ temperature: 0 }, { temperature: 0 }).mudou).toBe(false);
  });
});
