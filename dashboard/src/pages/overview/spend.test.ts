// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { spendByModel } from './spend';

/**
 * "Quanto custam os agentes?" — a pergunta que a tela respondia com o preço do plano (B-125).
 *
 * ## O que estava errado
 *
 * Medido em 2026-08-11 no navegador: o único valor em dinheiro na Overview era `USD 20/mo`, que é
 * a assinatura. O que os agentes gastam rodando modelos — o número que realmente varia com o uso
 * — não aparecia em lugar nenhum da tela inicial.
 *
 * ## Por que somar `tokensByModel` e não pedir um agregado
 *
 * `lens/observability` já é buscado pela faixa de atividade, com a MESMA chave de query das
 * páginas de capacidade. O custo sai da resposta que já chegou; pedir um endpoint de custo seria
 * uma segunda requisição para um dado que está na primeira.
 *
 * ## O caveat que não pode sumir
 *
 * O theo-lens conhece spans cujo modelo não tem preço na tabela. Um total que os ignora em
 * silêncio é um total menor que a verdade, apresentado como a verdade. A página de consumo por
 * usuário já mostra `unpricedSpans` por esse motivo, e esta função devolve a contagem para que a
 * tela não possa esquecer.
 */

function serie(entradas: { model: string; costUsd: number }[]) {
  return {
    tokensByModel: entradas.map((e, i) => ({
      periodStart: `2026-08-${String(10 + i).padStart(2, '0')}T00:00:00Z`,
      model: e.model,
      totalTokens: 1000,
      costUsd: e.costUsd,
    })),
  };
}

describe('o custo vem de custo medido', () => {
  it('soma por modelo, não por balde', () => {
    // A série tem um balde por período POR modelo. Somar sem agrupar produziria uma lista com o
    // mesmo modelo repetido, e o operador leria dois gastos onde há um.
    const r = spendByModel(
      serie([
        { model: 'claude-opus-5', costUsd: 10 },
        { model: 'claude-opus-5', costUsd: 5 },
        { model: 'claude-haiku-4-5', costUsd: 1 },
      ]),
    );
    if (r === null) throw new Error('a série tinha custo e o módulo devolveu null');

    expect(r.models).toHaveLength(2);
    expect(r.models[0]).toMatchObject({ model: 'claude-opus-5', costUsd: 15 });
    expect(r.total).toBe(16);
  });

  it('ordena do mais caro para o mais barato', () => {
    // Quem olha um gasto quer saber onde ele está. A ordem de chegada da série é cronológica, o
    // que é a ordem errada para essa pergunta.
    const r = spendByModel(
      serie([
        { model: 'barato', costUsd: 1 },
        { model: 'caro', costUsd: 100 },
      ]),
    );
    if (r === null) throw new Error('a série tinha custo e o módulo devolveu null');
    expect(r.models.map((m) => m.model)).toEqual(['caro', 'barato']);
  });

  it('sem dado, devolve nulo — e isso não é zero', () => {
    // "Não consegui ler" não é "não gastou nada". Um zero renderizado sobre uma leitura que falhou
    // diria ao operador que os agentes não custaram — a mesma distinção que o resto da tela
    // defende.
    expect(spendByModel(null)).toBeNull();
    expect(spendByModel({})).toBeNull();
    expect(spendByModel({ tokensByModel: [] })).toBeNull();
  });

  it('reporta os spans sem preço, para que a tela não possa omiti-los', () => {
    // Um total que ignora spans sem preço em silêncio é menor que a verdade, apresentado como a
    // verdade. A contagem sai daqui justamente para que esquecê-la exija uma decisão.
    const r = spendByModel({ ...serie([{ model: 'm', costUsd: 2 }]), unpricedSpans: 17 });
    expect(r?.unpricedSpans).toBe(17);
  });

  it('ausência de `unpricedSpans` é zero, não desconhecido', () => {
    // O campo é opcional na resposta. Tratá-lo como "desconhecido" faria a tela avisar sobre uma
    // incerteza que não existe, e um aviso que sempre aparece deixa de ser lido.
    const r = spendByModel(serie([{ model: 'm', costUsd: 2 }]));
    expect(r?.unpricedSpans).toBe(0);
  });

  it('ignora entrada malformada em vez de somar NaN', () => {
    // Uma resposta com um balde estranho não pode transformar o total inteiro em `NaN` — o
    // operador veria "US$ NaN" e não teria como saber que o resto do número era bom.
    const r = spendByModel({
      tokensByModel: [
        { model: 'ok', costUsd: 3 },
        { model: 'sem-custo' },
        null,
        { costUsd: 9 },
      ],
    });
    expect(r?.total).toBe(3);
    expect(r?.models.map((m) => m.model)).toEqual(['ok']);
  });
});
