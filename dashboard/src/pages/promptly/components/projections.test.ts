import { describe, it, expect } from 'vitest';

import {
  catalogRows,
  revisionRows,
  revisionsWindow,
  labelRows,
  promotionConsequence,
  policySummary,
  resumoCatalogo,
  temProximaPagina,
  type CatalogRow,
  comentarioRows,
  promptsPorAmbiente,
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

    expect(linhas[0].labelsResumo).toBe('none');
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
    expect(frase).toMatch(/stops serving/i);
  });

  it('quando o label ainda não existe, a frase MUDA em vez de inventar a revisão que sai', () => {
    // Se o dado não existe, não se inventa o dado nem se implementa API para sustentar a frase.
    const frase = promotionConsequence({ label: 'canario', atual: null, alvo: 2 });

    expect(frase).not.toMatch(/stops serving/i);
    expect(frase).toContain('canario');
    expect(frase).toContain('v2');
    expect(frase).toMatch(/starts serving|does not point at any revision/i);
  });

  it('avisa quando o label já serve exatamente a revisão escolhida', () => {
    // Promover para onde já está não é erro — é um clique que não muda nada, e dizer isso evita
    // que o operador ache que a promoção falhou.
    const frase = promotionConsequence({ label: 'prod', atual: 5, alvo: 5 });

    expect(frase).toMatch(/already serves/i);
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
    expect(resumo.texto).toMatch(/unrestricted|no rule governs/i);
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
    ({ name: 'a', latestVersion: 1, labels: [], updatedAt: '', labelsResumo: 'none', ...over }) as CatalogRow;

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

/**
 * M13 — a leitura do sinal de continuação, no cliente.
 *
 * Espelha `proximaPaginaQuery` do BFF (Go) pela mesma razão que ele existe: a RFC 5988 permite o
 * valor com aspas duplas, simples ou sem aspas, e ler só a grafia que NÓS emitimos produziria um
 * total falso no dia em que um proxy normalizasse o header.
 */
describe('temProximaPagina', () => {
  it('reconhece o marcador nas três grafias válidas da RFC', () => {
    expect(temProximaPagina('</v1/x?after=z>; rel="next"')).toBe(true);
    expect(temProximaPagina("</v1/x?after=z>; rel='next'")).toBe(true);
    expect(temProximaPagina('</v1/x?after=z>; rel=next')).toBe(true);
  });

  // O PAR QUE DISCRIMINA: header presente, decisão oposta.
  it('não confunde outro rel com continuação', () => {
    expect(temProximaPagina('</v1/x?after=z>; rel="prev"')).toBe(false);
    expect(temProximaPagina('</v1/x?after=z>; rel="nextpage"')).toBe(false);
  });

  it('header ausente é ausência de continuação, não erro', () => {
    expect(temProximaPagina(null)).toBe(false);
    expect(temProximaPagina('')).toBe(false);
  });

  it('encontra o marcador quando vários links vêm na mesma linha', () => {
    expect(temProximaPagina('</v1/x?a=1>; rel="prev", </v1/x?a=2>; rel="next"')).toBe(true);
  });

  // TA-06 — o regex casava `rel=next` em qualquer lugar da string, inclusive DENTRO da URL de um
  // link `prev`. O lado TS era mais frouxo que o Go que ele diz espelhar.
  it('não confunde rel=next DENTRO da URL de um link prev', () => {
    expect(temProximaPagina('</v1/x?after=a&rel=next>; rel="prev"')).toBe(false);
  });

  it('exige o enquadramento do link — texto solto não é continuação', () => {
    expect(temProximaPagina('nada disso; rel=next')).toBe(false);
  });
});

describe('revisionRows — a intenção (M17)', () => {
  it('a descricao atravessa quando existe', () => {
    const linhas = revisionRows([
      { version: 1, content: 'x', createdAt: 'd', changeDescription: 'encurtei o preambulo' },
    ]);

    expect(linhas[0]?.changeDescription).toBe('encurtei o preambulo');
  });

  it('revisao ANTERIOR ao milestone projeta null — nunca texto inventado', () => {
    // A regra que o DoD-1 nomeia: "nunca uma descrição inventada retroativamente,
    // pela mesma razão que o `createdBy` do M7 é `null` no passado".
    const linhas = revisionRows([{ version: 1, content: 'x', createdAt: 'd' }]);

    expect(linhas[0]?.changeDescription).toBeNull();
  });

  it('descricao malformada vira null em vez de derrubar a lista', () => {
    const linhas = revisionRows([
      { version: 1, content: 'x', createdAt: 'd', changeDescription: 42 },
    ]);

    expect(linhas[0]?.changeDescription).toBeNull();
    expect(linhas[0]?.content).toBe('x');
  });

  it('a config atravessa, e temperature 0 sobrevive', () => {
    const linhas = revisionRows([
      { version: 1, content: 'x', createdAt: 'd', modelConfig: { temperature: 0 } },
    ]);

    expect(linhas[0]?.modelConfig).toEqual({ temperature: 0 });
  });

  it('sem config, a linha traz null — nao objeto vazio', () => {
    const linhas = revisionRows([{ version: 1, content: 'x', createdAt: 'd' }]);

    expect(linhas[0]?.modelConfig).toBeNull();
  });
});

describe('M18 — a data do comentário é lida por gente', () => {
  it('formata_a_data_em_vez_de_repassar_iso_cru', () => {
    // A aceitação do M18 no app-dev mostrou "autor não registrado · 2026-08-04T17:13:42.848Z".
    // O carimbo é o único eixo temporal que quem lê a discussão tem: se ele exige decodificar um
    // ISO de cabeça, ele não está sendo lido — está sendo pulado.
    const [linha] = comentarioRows([
      { id: 'c1', body: 'ok', author: 'ana', createdAt: '2026-08-04T17:13:42.848Z' },
    ]);
    expect(linha?.quando).toBeTruthy();
    expect(linha?.quando).not.toContain('T');
    expect(linha?.quando).not.toContain('Z');
  });

  it('data_ausente_ou_invalida_nao_vira_texto_falso', () => {
    // O CONTROLE: sem data, a projeção não inventa "agora" nem imprime "Invalid Date". Diz que
    // não sabe — a mesma disciplina do autor ausente.
    const [semData] = comentarioRows([{ id: 'c1', body: 'ok', author: null }]);
    expect(semData?.quando).toBe('');
    const [lixo] = comentarioRows([{ id: 'c2', body: 'ok', createdAt: 'nao-e-data' }]);
    expect(lixo?.quando).toBe('');
  });
});

describe('promptsPorAmbiente (B-129)', () => {
  const linha = (name: string, labels: { label: string; version: number }[]) => ({
    name,
    latestVersion: 3,
    labels,
    updatedAt: '2026-08-01T10:00:00Z',
    labelsResumo: '',
    tags: [] as readonly string[],
  });

  it('counts how many prompts each environment serves, largest first', () => {
    // The `Environments` card says `2`. It does not say WHICH, nor that one of them serves
    // everything while the other serves one prompt — and that asymmetry is what tells an operator
    // where a bad promotion would actually land.
    const bars = promptsPorAmbiente([
      linha('a', [{ label: 'prod', version: 1 }, { label: 'staging', version: 3 }]),
      linha('b', [{ label: 'prod', version: 2 }]),
    ]);

    expect(bars).toEqual([
      { label: 'prod', value: 2 },
      { label: 'staging', value: 1 },
    ]);
  });

  it('counts a prompt once per environment, not once per label version', () => {
    // A prompt carrying `prod → v1` twice (a malformed payload) must not inflate `prod` to 2. The
    // bar counts PROMPTS; counting label rows instead would silently overstate reach.
    const bars = promptsPorAmbiente([
      linha('a', [{ label: 'prod', version: 1 }, { label: 'prod', version: 2 }]),
    ]);
    expect(bars).toEqual([{ label: 'prod', value: 1 }]);
  });

  it('prompts serving nobody get their own bar', () => {
    // `semAmbiente` is already a KPI, so hiding these from the chart would make the bars disagree
    // with a number on the same screen. Serving nobody is a state, not an absence.
    const bars = promptsPorAmbiente([linha('a', []), linha('b', [{ label: 'prod', version: 1 }])]);
    expect(bars).toEqual([
      { label: 'prod', value: 1 },
      { label: 'not promoted', value: 1 },
    ]);
  });

  it('not promoted sorts last even when it dominates', () => {
    // It is a residue, not a destination. Letting it head the chart would answer "where do my
    // prompts run?" with "nowhere", burying the environments that do exist.
    const bars = promptsPorAmbiente([
      linha('a', []),
      linha('b', []),
      linha('c', [{ label: 'prod', version: 1 }]),
    ]);
    expect(bars.map((b) => b.label)).toEqual(['prod', 'not promoted']);
  });

  it('an empty catalog yields no bars', () => {
    expect(promptsPorAmbiente([])).toEqual([]);
  });
});
