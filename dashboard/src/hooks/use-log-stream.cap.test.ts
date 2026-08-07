import { describe, it, expect } from 'vitest';

import { capLogLines, MAX_LOG_LINES } from '@/hooks/deploy/use-log-stream';

/**
 * B-016 — o teto FIFO aplicado ao snapshot historico.
 *
 * O defeito: `useLogStream` sempre capou o stream em MAX_LOG_LINES, mas o
 * snapshot REST entrava INTEIRO — `setHistorical((data.entries ?? []).map(...))`
 * sem corte. Um build com centenas de milhares de linhas ia todo para a memoria
 * e, via LogViewer (que materializa uma linha de DOM por linha de log), para a
 * arvore. O FIFO do stream so passava a valer depois, sobre um array que ja
 * havia estourado.
 *
 * A regra virou funcao pura para ser testavel sem renderizar 5000 linhas em
 * jsdom — a primeira versao deste teste montava a aba inteira e levava 5s por
 * caso, o que e um teste que ninguem roda de bom grado.
 */
describe('capLogLines (B-016)', () => {
  it('nao corta quando cabe no teto', () => {
    const linhas = ['a', 'b', 'c'];
    expect(capLogLines(linhas, 10)).toEqual(['a', 'b', 'c']);
  });

  it('nao corta exatamente no limite', () => {
    const linhas = Array.from({ length: 5 }, (_, i) => i);
    expect(capLogLines(linhas, 5)).toHaveLength(5);
  });

  it('mantem as ULTIMAS linhas quando excede — em log, o fim e o que interessa', () => {
    const linhas = Array.from({ length: 10 }, (_, i) => i);
    expect(capLogLines(linhas, 3)).toEqual([7, 8, 9]);
  });

  it('devolve uma copia — nao entrega o array de entrada para ser mutado', () => {
    const linhas = ['a', 'b'];
    const saida = capLogLines(linhas, 10);
    expect(saida).not.toBe(linhas);
    saida.push('c');
    expect(linhas).toEqual(['a', 'b']);
  });

  it('aguenta o vazio sem caso especial', () => {
    expect(capLogLines([], 5)).toEqual([]);
  });

  it('usa MAX_LOG_LINES por padrao — o MESMO teto do stream', () => {
    const excedente = Array.from({ length: MAX_LOG_LINES + 7 }, (_, i) => i);
    const saida = capLogLines(excedente);

    expect(saida).toHaveLength(MAX_LOG_LINES);
    // A ultima linha do build sobrevive; as 7 primeiras nao.
    expect(saida.at(-1)).toBe(MAX_LOG_LINES + 6);
    expect(saida[0]).toBe(7);
  });

  it('o default acompanha o teto do stream — nao e um 5000 escrito a mao', () => {
    // Se alguem mudar MAX_LOG_LINES, este teste continua valendo em vez de
    // congelar um numero velho. Era a divergencia que o snapshot introduziria.
    const n = MAX_LOG_LINES + 1;
    expect(capLogLines(Array.from({ length: n }, (_, i) => i))).toHaveLength(MAX_LOG_LINES);
  });
});
