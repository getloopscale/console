// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { calcularPaginacao } from './pagination';

describe('calcularPaginacao', () => {
  it('divide o total em páginas do tamanho pedido', () => {
    expect(calcularPaginacao(137, 1, 20).pageCount).toBe(7);
    expect(calcularPaginacao(140, 1, 20).pageCount).toBe(7);
    expect(calcularPaginacao(141, 1, 20).pageCount).toBe(8);
  });

  it('uma lista vazia tem UMA página, não zero', () => {
    // `pageCount: 0` faria o rodapé dizer "Page 1 / 0" e o botão Next comparar contra zero. A
    // lista vazia é uma página vazia.
    const p = calcularPaginacao(0, 1, 20);
    expect(p.pageCount).toBe(1);
    expect(p.firstShown).toBe(0);
    expect(p.lastShown).toBe(0);
    expect(p.resumo).toBe('Showing 0–0 of 0');
  });

  it('a faixa mostrada é 1-based e fecha no total', () => {
    expect(calcularPaginacao(137, 1, 20).resumo).toBe('Showing 1–20 of 137');
    expect(calcularPaginacao(137, 2, 20).resumo).toBe('Showing 21–40 of 137');
    // A última página é parcial: 137 = 6×20 + 17.
    expect(calcularPaginacao(137, 7, 20).resumo).toBe('Showing 121–137 of 137');
  });

  it('uma página exatamente cheia não conta um item a mais', () => {
    // O erro clássico de fencepost: `lastShown` sem o `Math.min` diria 140 num total de 137.
    expect(calcularPaginacao(140, 7, 20).lastShown).toBe(140);
    expect(calcularPaginacao(137, 7, 20).lastShown).toBe(137);
  });

  it('uma página além do fim não inventa itens', () => {
    // Acontece de verdade: apagar registros encolhe o total enquanto alguém está na última página.
    // A aritmética tem de continuar coerente até o `usePaginacao` corrigir a página.
    const p = calcularPaginacao(10, 5, 20);
    expect(p.lastShown).toBe(10);
    expect(p.firstShown).toBe(81);
    expect(p.pageCount).toBe(1);
  });

  it('o resumo fala inglês', () => {
    // B-184 — uma das cinco cópias dizia "Mostrando … de …". Num produto em inglês isso não lê
    // como tradução pendente; lê como uma parte que veio de outro lugar.
    expect(calcularPaginacao(5, 1, 20).resumo).toMatch(/^Showing \d+–\d+ of \d+$/);
  });
});
