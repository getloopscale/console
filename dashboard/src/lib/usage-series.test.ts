import { describe, it, expect } from 'vitest';

import { densificar, type PontoDaSerie } from './usage-series';

/**
 * M144 — a densificação.
 *
 * A série do M143 é ESPARSA por decisão: um dia sem consumo não produz ponto, porque um zero
 * inventado é indistinguível de consumo real zero. Mas o `seriesPath` só quebra a linha onde recebe
 * um `y` não-finito — ele precisa RECEBER o buraco. Alguém tem de transformar "ausência de ponto"
 * em "ponto ausente", e é esta função.
 *
 * É exatamente o que toda biblioteca de gráfico espera (`null` no array), e é a razão de o padrão
 * delas ser não-conectar.
 */

const DIA = 86_400_000;
/** 2026-07-20T00:00:00Z — âncora fixa; `Date.now()` num teste é não-determinismo (`testing.md § 6`). */
const D20 = Date.UTC(2026, 6, 20);

// `outputTokens` NÃO é zero. Com ele zerado, somar ou não a saída no campo derivado `tokens` dá o
// mesmo resultado, e a mutação "conta só a entrada" sobrevive — foi exatamente o F-1 que o review do
// M143 encontrou na série do engine, cometido de novo aqui. Fixture que não distingue não mede.
const ponto = (diaISO: string, v: number): PontoDaSerie => ({
  periodStart: diaISO,
  inputTokens: v,
  outputTokens: Math.floor(v / 4),
  cacheReadTokens: v * 3,
  cacheCreationTokens: v * 2,
  costUsd: v / 1000,
});

describe('densificar', () => {
  it('um dia sem ponto vira NaN, nunca zero', () => {
    // dias 20 e 22 presentes; 21 ausente
    const pontos = densificar([ponto('2026-07-20T00:00:00.000Z', 10), ponto('2026-07-22T00:00:00.000Z', 30)], D20, 3, 'inputTokens');
    expect(pontos).toHaveLength(3);
    expect(pontos[0]?.y).toBe(10);
    // NaN e não 0: um zero inventado é indistinguível de consumo real zero, que é a mentira que a
    // M143 pagou para evitar ao devolver série com lacuna.
    expect(Number.isFinite(pontos[1]?.y)).toBe(false);
    expect(pontos[2]?.y).toBe(30);
  });

  it('série completa não ganha NaN algum', () => {
    const pontos = densificar(
      [ponto('2026-07-20T00:00:00.000Z', 1), ponto('2026-07-21T00:00:00.000Z', 2), ponto('2026-07-22T00:00:00.000Z', 3)],
      D20, 3, 'inputTokens',
    );
    expect(pontos.every((p) => Number.isFinite(p.y))).toBe(true);
  });

  it('o eixo cobre a janela inteira mesmo com um ponto só', () => {
    const pontos = densificar([ponto('2026-07-22T00:00:00.000Z', 5)], D20, 3, 'inputTokens');
    expect(pontos).toHaveLength(3);
    expect(pontos.filter((p) => Number.isFinite(p.y))).toHaveLength(1);
  });

  // "não consumiu na janela" e "não está no recorte" são fatos diferentes. Série vazia some do
  // gráfico sem dizer nada; série toda em lacuna mantém o nome na legenda.
  it('usuário sem ponto algum produz série toda em lacuna, NÃO uma série vazia', () => {
    const pontos = densificar([], D20, 3, 'inputTokens');
    expect(pontos).toHaveLength(3);
    expect(pontos.every((p) => !Number.isFinite(p.y))).toBe(true);
  });

  // O eixo é TEMPORAL, não índice. Dois usuários com dias diferentes têm de cair na mesma posição
  // de `x` para o mesmo dia — senão as linhas ficam desalinhadas entre si.
  it('x é o dia em epoch-ms, não o índice', () => {
    const a = densificar([ponto('2026-07-22T00:00:00.000Z', 1)], D20, 3, 'inputTokens');
    const b = densificar([ponto('2026-07-20T00:00:00.000Z', 9)], D20, 3, 'inputTokens');
    expect(a.map((p) => p.x)).toEqual(b.map((p) => p.x));
    expect(a[0]?.x).toBe(D20);
    expect(a[2]?.x).toBe(D20 + 2 * DIA);
  });

  it('projeta o campo pedido — custo e tokens saem da mesma série', () => {
    const s = [ponto('2026-07-20T00:00:00.000Z', 2000)]; // out=500, cacheRead=6000, cacheCreation=4000
    expect(densificar(s, D20, 1, 'inputTokens')[0]?.y).toBe(2000);
    expect(densificar(s, D20, 1, 'costUsd')[0]?.y).toBe(2);
    // `tokens` é DERIVADO: entrada + saída, como a coluna da tabela. Somar só a entrada
    // subnotificaria o gráfico em relação à tabela que está logo acima dele.
    expect(densificar(s, D20, 1, 'tokens')[0]?.y).toBe(2500);
    expect(densificar(s, D20, 1, 'cacheReadTokens')[0]?.y).toBe(6000);
  });
});
