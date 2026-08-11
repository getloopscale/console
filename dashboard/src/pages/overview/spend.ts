/**
 * O que os agentes custaram, por modelo (B-125).
 *
 * ## O que estava errado
 *
 * Medido em 2026-08-11: o único valor em dinheiro na Overview era `USD 20/mo` — o preço do plano.
 * O gasto que varia com o uso, e que é o número pelo qual alguém se assusta, não aparecia na tela
 * inicial de um produto cujas capacidades rodam modelos.
 *
 * ## De onde sai
 *
 * De `lens/observability`, que a faixa de atividade já busca com a MESMA chave de query das
 * páginas de capacidade. O custo está na resposta que já chegou; pedir um endpoint próprio seria
 * uma segunda requisição para um dado da primeira.
 *
 * ## O caveat que não pode sumir
 *
 * O theo-lens conhece spans cujo modelo não tem preço na tabela, e um total que os ignora em
 * silêncio é menor que a verdade apresentado como a verdade. `unpricedSpans` sai daqui para que
 * esquecê-lo na tela exija uma decisão em vez de um descuido.
 */

export interface ModelSpend {
  readonly model: string;
  readonly costUsd: number;
}

export interface Spend {
  readonly total: number;
  /** Do mais caro para o mais barato: quem olha um gasto quer saber onde ele está. */
  readonly models: readonly ModelSpend[];
  /** Spans cujo modelo não tem preço. Fora do total, e visíveis por contrato. */
  readonly unpricedSpans: number;
}

/**
 * Agrega a série de custo por modelo.
 *
 * Devolve `null` quando não há o que somar — e `null` não é zero. Um zero renderizado sobre uma
 * leitura que falhou diria ao operador que os agentes não custaram nada, que é a mesma confusão
 * entre ignorância e ausência que o resto desta tela recusa.
 */
export function spendByModel(dados: unknown): Spend | null {
  if (typeof dados !== 'object' || dados === null) return null;

  const serie = (dados as { tokensByModel?: unknown }).tokensByModel;
  if (!Array.isArray(serie) || serie.length === 0) return null;

  const porModelo = new Map<string, number>();
  for (const b of serie) {
    if (typeof b !== 'object' || b === null) continue;
    const bucket = b as { model?: unknown; costUsd?: unknown };
    // Um balde malformado é ignorado em vez de somado: `NaN` no total renderiza "US$ NaN" e o
    // operador não tem como saber que o resto do número era bom.
    if (typeof bucket.model !== 'string' || typeof bucket.costUsd !== 'number') continue;
    if (!Number.isFinite(bucket.costUsd)) continue;
    porModelo.set(bucket.model, (porModelo.get(bucket.model) ?? 0) + bucket.costUsd);
  }

  if (porModelo.size === 0) return null;

  const models = [...porModelo.entries()]
    .map(([model, costUsd]) => ({ model, costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const bruto = (dados as { unpricedSpans?: unknown }).unpricedSpans;

  return {
    total: models.reduce((acc, m) => acc + m.costUsd, 0),
    models,
    // Ausente é zero, não desconhecido: o campo é opcional na resposta, e tratá-lo como incerteza
    // faria a tela avisar sobre um risco que não existe — e um aviso que sempre aparece some.
    unpricedSpans: typeof bruto === 'number' && Number.isFinite(bruto) ? bruto : 0,
  };
}
