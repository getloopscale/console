import { describe, it, expect } from 'vitest';

import {
  catalogRows,
  revisionRows,
  revisionsWindow,
  labelRows,
  promotionConsequence,
  policySummary,
  resumoCatalogo,
  type CatalogRow,
} from './projections';

/**
 * A lógica de projeção vive FORA do React e é testada sem browser. O que se prova aqui é o que a
 * tela AFIRMA — não que ela renderizou.
 */

describe('catalogRows', () => {
  it('projeta uma linha por prompt com os labels que ele serve', () => {
    const linhas = catalogRows([
      { name: 'saudacao', latestVersion: 3, labels: [{ label: 'prod', version: 1 }], updatedAt: '2026-08-01T10:00:00Z' },
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0].name).toBe('saudacao');
    expect(linhas[0].latestVersion).toBe(3);
    expect(linhas[0].labels).toEqual([{ label: 'prod', version: 1 }]);
  });

  it('devolve lista vazia para payload que não é lista', () => {
    // Falha de leitura chega como `null`/erro, e o componente distingue esse caso. Aqui só se
    // garante que a projeção não explode — quem decide a frase é a tela.
    expect(catalogRows(null)).toEqual([]);
    expect(catalogRows(undefined)).toEqual([]);
    expect(catalogRows({ prompts: [] } as unknown)).toEqual([]);
  });

  it('descreve como "nenhum" o prompt sem label de ambiente', () => {
    // O prompt existe e não serve ambiente algum — estado normal, distinto de "não sei".
    const linhas = catalogRows([{ name: 'rascunho', latestVersion: 1, labels: [], updatedAt: '' }]);

    expect(linhas[0].labelsResumo).toBe('nenhum');
  });

  it('resume os labels na forma que o operador lê: label seguido da revisão que ele serve', () => {
    const linhas = catalogRows([
      {
        name: 'saudacao',
        latestVersion: 9,
        labels: [
          { label: 'prod', version: 4 },
          { label: 'staging', version: 8 },
        ],
        updatedAt: '',
      },
    ]);

    expect(linhas[0].labelsResumo).toBe('prod → v4, staging → v8');
  });
});

describe('revisionRows', () => {
  // Os dois casos que viviam aqui — 'projeta um TRECHO' e 'não corta conteúdo curto' — foram
  // REMOVIDOS junto com o campo `preview`. Eles afirmavam o oposto do que o M12 entregou: que a
  // lista trunca o corpo. A DoD passou a exigir a revisão INTEIRA, e o BLOCKER 3 do review a
  // implementou. Manter os testes seria pior que código morto — seria um guard defendendo o
  // comportamento que o milestone removeu de propósito.
  //
  // O que substitui está em `pages/promptly/detail.test.tsx::detail_renders_the_full_content_not_an_excerpt`,
  // e a asserção lá mira o FIM do corpo — porque uma asserção sobre o começo passaria com trecho.

  it('ordena da revisão mais nova para a mais antiga', () => {
    // Quem abre um prompt quer ver o que está valendo agora; a arqueologia vem depois.
    const linhas = revisionRows([
      { version: 1, content: 'v1', createdAt: '' },
      { version: 3, content: 'v3', createdAt: '' },
      { version: 2, content: 'v2', createdAt: '' },
    ]);

    expect(linhas.map((l) => l.version)).toEqual([3, 2, 1]);
  });
});

describe('revisionsWindow', () => {
  // O defeito que este cálculo existe para impedir (#364): a rota de revisões ordena da MAIS
  // ANTIGA para a mais nova e corta com `limit`. Pedir `limit=10` num prompt de 30 revisões
  // devolve v1..v10 — e a tela as rotulava "as 10 mais recentes". Numa tela de PROMOÇÃO isso é
  // grave: quem promove "a mais recente da lista" reaponta produção para uma revisão velha.

  it('pede a ÚLTIMA janela: com 30 revisões e limite 10, começa depois da v20', () => {
    expect(revisionsWindow(30, 10)).toEqual({ after: 20 });
  });

  it('não usa cursor quando o prompt cabe inteiro na página', () => {
    // 8 revisões e limite 10: pedir `after` cortaria linhas que a página comporta.
    expect(revisionsWindow(8, 10)).toEqual({ after: 0 });
    expect(revisionsWindow(10, 10)).toEqual({ after: 0 });
  });

  it('trata a fronteira exata: 11 revisões e limite 10 começa depois da v1', () => {
    expect(revisionsWindow(11, 10)).toEqual({ after: 1 });
  });

  it('sem saber a última versão, não inventa cursor — pede do começo', () => {
    // `latestVersion` desconhecido é o estado em que o catálogo ainda não respondeu. Chutar um
    // cursor aqui esconderia revisões; pedir do começo mostra MENOS do que se quer, nunca o
    // errado rotulado como certo.
    expect(revisionsWindow(null, 10)).toEqual({ after: 0 });
    expect(revisionsWindow(0, 10)).toEqual({ after: 0 });
  });
});

describe('labelRows', () => {
  it('projeta cada label com a revisão que ele serve hoje', () => {
    expect(labelRows([{ label: 'prod', version: 4 }])).toEqual([{ label: 'prod', version: 4 }]);
  });

  it('ignora payload que não é lista', () => {
    expect(labelRows(null)).toEqual([]);
  });
});

describe('promotionConsequence', () => {
  it('nomeia QUAL revisão deixa de servir o label', () => {
    // O critério do milestone, literal: não "o item será alterado", mas qual versão sai de
    // produção. O número vem do que a API devolve em `/labels` — não é inferido.
    const frase = promotionConsequence({ label: 'prod', atual: 4, alvo: 7 });

    expect(frase).toContain('prod');
    expect(frase).toContain('v4');
    expect(frase).toContain('v7');
    expect(frase).toMatch(/deixa de servir/i);
  });

  it('quando o label ainda não existe, a frase MUDA em vez de inventar a revisão que sai', () => {
    // Se o dado não existe, não se inventa o dado nem se implementa API para sustentar a frase.
    const frase = promotionConsequence({ label: 'canario', atual: null, alvo: 2 });

    expect(frase).not.toMatch(/deixa de servir/i);
    expect(frase).toContain('canario');
    expect(frase).toContain('v2');
    expect(frase).toMatch(/passa a servir|ainda não aponta/i);
  });

  it('avisa quando o label já serve exatamente a revisão escolhida', () => {
    // Promover para onde já está não é erro — é um clique que não muda nada, e dizer isso evita
    // que o operador ache que a promoção falhou.
    const frase = promotionConsequence({ label: 'prod', atual: 5, alvo: 5 });

    expect(frase).toMatch(/já serve/i);
  });
});

describe('policySummary', () => {
  it('descreve a regra que barra a promoção, com o limiar exigido', () => {
    const resumo = policySummary({ datasetId: 'ds-1', minScore: 0.8 });

    expect(resumo.livre).toBe(false);
    expect(resumo.texto).toContain('0.8');
    expect(resumo.texto).toContain('ds-1');
  });

  it('sem política, declara promoção LIVRE — não "não consegui ler"', () => {
    // `null` aqui significa 404 tipado do serviço: a ausência de regra é um fato, e a tela precisa
    // dizê-lo com todas as letras. Renderizá-lo igual a uma falha de leitura é o defeito que o
    // DESIGN.md § 5 nomeia.
    const resumo = policySummary(null);

    expect(resumo.livre).toBe(true);
    expect(resumo.texto).toMatch(/livre|nenhuma regra/i);
  });
});

/**
 * M13 — o resumo do catálogo, e a honestidade sobre o que ele NÃO sabe.
 *
 * O painel derive seus números desta função. O caso que decide o milestone é o controle negativo
 * de parcialidade: um catálogo de EXATAMENTE `limit` prompts, sem continuação, não pode ser
 * marcado parcial — é o falso positivo que a heurística `linhas.length >= limit` produziria, e
 * marcar de parcial um número correto ensina o operador a desconfiar dele.
 */
describe('resumoCatalogo', () => {
  const linha = (over: Partial<CatalogRow> = {}): CatalogRow =>
    ({ name: 'a', latestVersion: 1, labels: [], updatedAt: '', labelsResumo: 'nenhum', ...over }) as CatalogRow;

  it('conta prompt com revisão nova que nenhum label serve', () => {
    const r = resumoCatalogo([linha({ latestVersion: 4, labels: [{ label: 'prod', version: 3 }] })], false);
    expect(r.naoPromovidos).toBe(1);
  });

  // O PAR QUE DISCRIMINA do KPI: mesma forma, decisão oposta.
  it('não conta prompt cuja última revisão já serve', () => {
    const r = resumoCatalogo([linha({ latestVersion: 3, labels: [{ label: 'prod', version: 3 }] })], false);
    expect(r.naoPromovidos).toBe(0);
  });

  it('conta prompt sem label algum como sem ambiente E como não promovido', () => {
    const r = resumoCatalogo([linha({ latestVersion: 1, labels: [] })], false);
    expect(r.semAmbiente).toBe(1);
    expect(r.naoPromovidos).toBe(1);
  });

  it('marca parcial quando o serviço sinaliza continuação', () => {
    const r = resumoCatalogo([linha(), linha({ name: 'b' })], true);
    expect(r.parcial).toBe(true);
  });

  // O CONTROLE NEGATIVO DO MILESTONE — impede `parcial = linhas.length >= PAGE_LIMIT`.
  it('NÃO marca parcial num catálogo cheio sem continuação', () => {
    const cheio = Array.from({ length: 100 }, (_, i) => linha({ name: `p${String(i)}` }));
    const r = resumoCatalogo(cheio, false);
    expect(r.parcial).toBe(false);
    expect(r.prompts).toBe(100);
  });

  it('resumo de catálogo vazio é zerado e não parcial', () => {
    const r = resumoCatalogo([], false);
    expect(r.prompts).toBe(0);
    expect(r.parcial).toBe(false);
    expect(r.revisoesPublicadas).toBe(0);
  });

  // EC-5 — dado parcial vira NaN silencioso: Math.max() de lista vazia é -Infinity e somar
  // undefined dá NaN. Números errados exibidos com a mesma confiança dos certos.
  it('trata linha sem labels como sem ambiente, sem produzir NaN', () => {
    const r = resumoCatalogo([{ name: 'a', latestVersion: 1 } as unknown as CatalogRow], false);
    expect(r.semAmbiente).toBe(1);
    expect(Number.isFinite(r.revisoesPublicadas)).toBe(true);
  });

  it('ignora linha sem latestVersion em vez de contar NaN', () => {
    const r = resumoCatalogo([{ name: 'a', labels: [] } as unknown as CatalogRow], false);
    expect(Number.isNaN(r.revisoesPublicadas)).toBe(false);
  });

  // EC-6 — trava a DEFINIÇÃO ("escrita e não serve ninguém") contra a leitura vizinha
  // ("atrasada em prod"), que é outra métrica e não entra neste milestone.
  it('não conta como não promovido quando a última revisão serve algum ambiente', () => {
    const r = resumoCatalogo(
      [linha({ latestVersion: 3, labels: [{ label: 'prod', version: 2 }, { label: 'staging', version: 3 }] })],
      false,
    );
    expect(r.naoPromovidos).toBe(0);
    expect(r.ambientes).toBe(2);
  });
});
