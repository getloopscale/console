import { describe, it, expect } from 'vitest';

import { densificar, janelaDaSerie, type PontoDaSerie } from './usage-series';

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

  /**
   * A truncação ao dia era INOBSERVÁVEL pela suíte: todo `periodStart` e todo `inicioMs` dos casos
   * acima é meia-noite exata, então `Math.floor(t / DIA) * DIA` é um no-op em 100% deles e trocá-lo
   * por `t` deixa tudo verde. O defeito que ela impede não é cosmético — com `periodStart` fora da
   * meia-noite e o início derivado dele, as chaves do mapa (meia-noite) nunca casariam com os `x`
   * gerados, e TODO dia viraria lacuna: o gráfico inteiro vazio, com o dado correto.
   */
  it('o dia é a CHAVE, não o instante — periodStart fora da meia-noite ainda casa', () => {
    const pontos = densificar([ponto('2026-07-20T13:45:00.000Z', 10)], D20 + 13 * 3_600_000, 1, 'inputTokens');
    expect(pontos[0]?.x).toBe(D20);
    expect(pontos[0]?.y).toBe(10);
  });

  it('ponto fora da janela não aparece e não desloca os demais', () => {
    const fora = ponto('2026-07-19T00:00:00.000Z', 99); // um dia ANTES do início
    const pontos = densificar([fora, ponto('2026-07-21T00:00:00.000Z', 7)], D20, 3, 'inputTokens');
    expect(pontos.map((p) => p.y)).toEqual([Number.NaN, 7, Number.NaN]);
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

/**
 * M144 pós-review — a JANELA.
 *
 * `cabeSerie` orça `(days + 1) × linhas` porque uma janela ROLANTE de N dias atravessa N+1 dias de
 * calendário. O eixo, 150 linhas depois no mesmo arquivo, gerava `days` fatias a partir de
 * `fim - (days-1)`: o balde mais antigo — dado real, já pago pelo orçamento — caía fora e sumia sem
 * erro algum. Nenhum teste pegava, porque todos os fixtures usavam 3 baldes.
 *
 * E ancorar o fim no maior `periodStart` VISTO tinha um segundo efeito não declarado: se ninguém
 * consumiu nos últimos dias, o eixo termina no último dia com consumo, e os dias de silêncio — que
 * são informação de primeira ordem para quem lidera — não aparecem como lacuna; eles não existem.
 */
describe('janelaDaSerie', () => {
  const DIA = 86_400_000;
  const HOJE = Date.UTC(2026, 6, 22, 15, 30); // 22/jul, 15:30 UTC — de propósito fora da meia-noite

  it('cobre days + 1 fatias — o mesmo que o orçamento paga', () => {
    const { dias } = janelaDaSerie([Date.UTC(2026, 6, 20)], 30, HOJE);
    expect(dias).toBe(31);
  });

  it('termina HOJE, não no último dia com consumo — o silêncio final é visível', () => {
    // ninguém consome desde o dia 18; hoje é 22. Os quatro dias de silêncio TÊM de estar no eixo.
    const { inicio, dias } = janelaDaSerie([Date.UTC(2026, 6, 18)], 7, HOJE);
    expect(inicio + (dias - 1) * DIA).toBe(Date.UTC(2026, 6, 22));
  });

  it('nunca corta dado: um balde mais novo que o relógio estende a janela', () => {
    // relógio do navegador atrasado em relação ao serviço — o dado manda, não o relógio.
    const { inicio, dias } = janelaDaSerie([Date.UTC(2026, 6, 25)], 7, HOJE);
    expect(inicio + (dias - 1) * DIA).toBe(Date.UTC(2026, 6, 25));
  });

  it('sem ponto algum a janela ainda existe, ancorada no relógio', () => {
    const { inicio, dias } = janelaDaSerie([], 7, HOJE);
    expect(dias).toBe(8);
    expect(inicio + (dias - 1) * DIA).toBe(Date.UTC(2026, 6, 22));
  });
});
