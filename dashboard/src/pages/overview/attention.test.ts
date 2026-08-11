// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { MENUS } from '@/components/layout/app-sidebar-menus';
import { attentionItems, ATTENTION_SOURCES, type AttentionReading } from './attention';

/**
 * "Tem algo errado agora?" — a pergunta que nenhuma outra tela do produto responde (B-125).
 *
 * ## Por que ela não tem dono hoje
 *
 * Cada capacidade só enxerga a si mesma: a tela do Lens sabe da taxa de erro, a do Trust sabe do
 * que foi barrado, a do RAG sabe dos retrievals vazios. Ninguém junta. O operador só descobre um
 * problema abrindo a capacidade certa — o que exige já suspeitar de qual é.
 *
 * ## O que este módulo NÃO faz, e por que a lista importa mais que a implementação
 *
 * Ele deriva itens de atenção de sinais **medidos**, e recusa inventar os que não existem. Meu
 * próprio desenho da tela mostrava "2 deploys failed"; medido em `use-build-stats.ts:14`,
 * `BuildStatsDay` é `{ date, count }` — **não existe contagem de falha**. Desenhar aquela linha
 * teria sido fabricação com aparência de dado, que é o defeito mais caro deste repositório porque
 * tudo a jusante trata como fato.
 *
 * As três fontes que sobraram são as que o dado sustenta, e `ATTENTION_SOURCES` é a declaração
 * disso — um teste quantifica sobre ela, então uma quarta fonte não entra sem passar por aqui.
 */

const semNada: AttentionReading = {
  observability: { falhou: false, carregando: false, dados: null },
  rag: { falhou: false, carregando: false, dados: null },
  trust: { falhou: false, carregando: false, dados: null },
};

/** Tráfego com `n` erros em `total` traces, num balde só. */
function trafego(total: number, erros: number) {
  return {
    traffic: [{ periodStart: '2026-08-11T00:00:00Z', traceCount: total, errorCount: erros, errorRate: total === 0 ? 0 : erros / total }],
  };
}

describe('a faixa de atenção junta mais de uma capacidade', () => {
  it('as fontes declaradas cobrem capacidades DIFERENTES', () => {
    // O critério central da DoD. Um "precisa de você" alimentado por uma capacidade só seria a
    // tela do Lens com outro título — e a tela continuaria sem enxergar a plataforma, que é o
    // defeito inteiro deste item.
    expect(new Set(ATTENTION_SOURCES).size, 'duas fontes colapsaram numa').toBeGreaterThanOrEqual(3);
  });

  it('cada destino é uma capacidade que o menu declara', () => {
    // Uma linha que diz "41 bloqueios" e leva a uma rota inexistente informa e depois dá 404.
    //
    // A primeira versão deste caso checava `path === ''`, e o TypeScript provou que era morto: o
    // tipo literal já garante que nenhum é vazio. Um teste que o compilador já prova não é um
    // teste — é ruído que passa verde para sempre. Este afirma o que o tipo NÃO sabe: que o
    // destino existe no registro do menu.
    const doMenu = new Set(
      (MENUS.main?.groups.flatMap((g) => g.items.map((i) => i.path)) ?? []),
    );
    const orfas = ATTENTION_SOURCES.filter((s) => !doMenu.has(s.path)).map((s) => s.path);

    expect(orfas, 'destino que o menu não declara').toEqual([]);
  });
});

describe('nenhum item é inventado', () => {
  it('sem dado, nenhum item — e isso não é "está tudo bem"', () => {
    // A distinção que o repositório defende em toda superfície de leitura: "não consegui ler" não
    // é "não há". A tela decide como dizer isso; este módulo se recusa a produzir um item.
    expect(attentionItems(semNada)).toEqual([]);
  });

  it('leitura que FALHOU não vira item de atenção', () => {
    const falhou: AttentionReading = {
      ...semNada,
      observability: { falhou: true, carregando: false, dados: null },
    };
    expect(attentionItems(falhou)).toEqual([]);
  });

  it('não existe item de deploy falho, porque o dado não existe', () => {
    // `BuildStatsDay` é `{ date, count }`. Meu próprio desenho mostrava "2 deploys failed"; a
    // medição matou a linha. Este caso trava a ausência para que ela não volte por engano.
    const ids = ATTENTION_SOURCES.map((s) => s.id);
    expect(ids).not.toContain('deploys');
  });
});

describe('os três sinais que o dado sustenta', () => {
  it('erro de agente vira item quando passa do limiar', () => {
    const itens = attentionItems({
      ...semNada,
      observability: { falhou: false, carregando: false, dados: trafego(1000, 120) },
    });
    const erro = itens.find((i) => i.id === 'agent-errors');
    expect(erro, '12% de erro e nenhum item').toBeDefined();
    expect(erro?.severity).toBe('critical');
    expect(erro?.headline).toMatch(/12/);
  });

  it('erro dentro do normal NÃO vira item', () => {
    // A contraparte, e a que mantém a faixa legível: uma faixa que sempre tem linhas é uma faixa
    // que ninguém lê, e aí ela deixa de mostrar o caso real.
    const itens = attentionItems({
      ...semNada,
      observability: { falhou: false, carregando: false, dados: trafego(1000, 2) },
    });
    expect(itens.find((i) => i.id === 'agent-errors')).toBeUndefined();
  });

  it('retrieval vazio vira item, com a taxa que o serviço mediu', () => {
    const itens = attentionItems({
      ...semNada,
      rag: {
        falhou: false,
        carregando: false,
        dados: { totals: { retrievals: 4000, answers: 3800, empty_retrieval_rate: 0.12 } },
      },
    });
    const vazio = itens.find((i) => i.id === 'empty-retrievals');
    expect(vazio).toBeDefined();
    expect(vazio?.headline).toMatch(/12/);
  });

  it('bloqueios contam só o que foi BARRADO, não todo evento', () => {
    // `decision` distingue `block` de `modify` e `allow`. Contar os três produziria um número
    // maior e sem significado: "eventos de enforcement" inclui o que passou.
    const itens = attentionItems({
      ...semNada,
      trust: {
        falhou: false,
        carregando: false,
        dados: {
          events: [
            { decision: 'block', validatorName: 'pii-email' },
            { decision: 'block', validatorName: 'pii-email' },
            { decision: 'modify', validatorName: 'profanity' },
            { decision: 'allow', validatorName: 'pii-email' },
          ],
        },
      },
    });
    const barrado = itens.find((i) => i.id === 'blocked');
    expect(barrado).toBeDefined();
    expect(barrado?.headline, 'contou modify/allow junto').toMatch(/\b2\b/);
  });

  it('zero bloqueios não vira item', () => {
    const itens = attentionItems({
      ...semNada,
      trust: { falhou: false, carregando: false, dados: { events: [{ decision: 'allow' }] } },
    });
    expect(itens.find((i) => i.id === 'blocked')).toBeUndefined();
  });
});

describe('a ordem é por severidade, não por fonte', () => {
  it('o crítico vem antes do aviso', () => {
    // Quem lê a faixa lê de cima. Ordenar pela ordem em que as fontes foram declaradas colocaria
    // um aviso acima de um crítico por acidente de código.
    const itens = attentionItems({
      observability: { falhou: false, carregando: false, dados: trafego(1000, 120) },
      rag: {
        falhou: false,
        carregando: false,
        dados: { totals: { retrievals: 100, answers: 95, empty_retrieval_rate: 0.06 } },
      },
      trust: { falhou: false, carregando: false, dados: { events: [] } },
    });
    expect(itens.length).toBeGreaterThanOrEqual(2);
    expect(itens[0].severity).toBe('critical');
  });
});
