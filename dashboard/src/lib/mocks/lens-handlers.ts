import { registerRoute } from './server';

/**
 * M142 — o BFF de consumo por end-user, para que a jornada da tela entre no e2e hermético.
 *
 * Sem este handler a tela SOBE, o heading renderiza e ela mostra corretamente "Não foi possível
 * carregar o consumo" — estado em que `observability-screens.spec.ts` ficava VERDE, porque aquele
 * spec afirma heading, não conteúdo. Medido em 2026-08-03; é o defeito que o DoD-2 do M142 nomeia
 * ("uma tela pode responder 200 e não mostrar nada") e o motivo de este arquivo existir.
 *
 * A resposta é ESTÁTICA de propósito, ao contrário do `trustDb` mutável do M24: aqui não há
 * jornada de escrita para provar — o relatório é derivado dos spans ingeridos e a tela é somente
 * leitura. Um mock mutável seria maquinário que ninguém pediu.
 */

/**
 * Os números são os MEDIDOS no app-dev em 2026-08-03, não inventados: 49.373 spans do maior
 * consumidor, 17 spans com tokens e sem preço na tabela, e o run do `agent-builder-qa` que custou
 * exatamente zero por o modelo não estar precificado.
 *
 * Usar o dado real importa: um fixture com `costUsd: 1.23` em toda linha nunca exercitaria as
 * DUAS pontas de `formatCost` (4 casas abaixo de 1¢, 2 acima), que é onde mora a leitura perigosa.
 */
const USAGE_BY_USER = {
  users: [
    {
      userId: '90fff249680448f8c01bee8af21dd40dd76fe8fbd603e53e3513448581165bbe',
      spans: 49373,
      inputTokens: 3261202,
      outputTokens: 12590407,
      cacheReadTokens: 6405653920,
      cacheCreationTokens: 111933070,
      costUsd: 4179.475464,
    },
    // Ordenado por consumo JUNTO das demais linhas (ADR D6 do M140) — não fixado no fim.
    { userId: 'unattributed', spans: 3, inputTokens: 11716, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 },
    { userId: 'agent-builder-qa', spans: 1, inputTokens: 5725, outputTokens: 133, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 },
    { userId: 'b08873a43f7f5e970e401997b0c4da819142b89cfd318938de18affa44d00321', spans: 2, inputTokens: 10, outputTokens: 57, cacheReadTokens: 17585, cacheCreationTokens: 25583, costUsd: 0.034032 },
  ],
  unpricedSpans: 17,
  totalUsers: 4,
  windowDays: 30,
};

/**
 * O prefixo depende de `window.__THEO_CONFIG__.API_URL`, vazio em dev (same-origin) e `/api` atrás
 * do gateway. Registrar os dois é o que o `trust-handlers.ts` faz, pela razão registrada lá: sem
 * isso o mock funciona numa configuração e silenciosamente não na outra.
 */
/** As regras criadas na sessão — escopo de CARGA DA PÁGINA, como o cursor de `/connect`. */
const regrasDeAlerta: Record<string, unknown>[] = [];

export function registerLensHandlers() {
  for (const prefix of ['', '/api']) {
    // M22 — as regras de alerta, para a jornada do monitor de prompt rodar hermética.
    //
    // O laço sobre ['', '/api'] NÃO é decorativo: a tela chama por um prefixo e o e2e pelo outro,
    // e registrar só um faz a jornada falhar com 404 num caminho que funciona no navegador.
    registerRoute('GET', `${prefix}/v1/dashboard/lens/alert-rules`, async () =>
      Response.json({ alert_rules: regrasDeAlerta }),
    );
    registerRoute('POST', `${prefix}/v1/dashboard/lens/alert-rules`, async (req) => {
      const body = (await req.json()) as Record<string, unknown>;
      const regra = {
        id: `lar-${regrasDeAlerta.length + 1}`,
        enabled: true,
        status: 'OK',
        // `null` é "ainda não avaliado" — distinto de "sem dados". É o quarto DoD do M22, e a
        // distinção que impede o operador de concluir que a regra falhou e criar a segunda.
        last_evaluated_at: null,
        last_triggered_at: null,
        ...body,
      };
      regrasDeAlerta.push(regra);
      return Response.json(regra);
    });
    // A forma COMPLETA do contrato (`pages/settings/webhooks.tsx` — `interface Webhook`), não só
    // o que a tela de alertas lê.
    //
    // Esta rota é compartilhada com a tela de configurações, que renderiza `url` e `events`. A
    // primeira versão devolvia só `{id, label}` e quebrava aquela tela — regressão que só o e2e
    // de observabilidade pegou, porque nenhum teste meu passava por lá. Um mock que serve um
    // consumidor e quebra outro é pior que mock nenhum: ele mente com aparência de dado.
    registerRoute('GET', `${prefix}/v1/settings/webhooks/list`, async () =>
      Response.json({
        webhooks: [
          {
            id: 'wwh-1',
            url: 'https://example.invalid/hooks/prod',
            label: 'prod hook',
            events: ['alert.threshold_breached'],
            created_at: '2026-08-01T00:00:00Z',
          },
        ],
      }),
    );
    // M23 — as resoluções de UM prompt, no explorador que já existe.
    //
    // O handler HONRA o `span_query`. Um mock que devolvesse a mesma lista com e sem filtro faria
    // a jornada passar sem provar nada: o defeito que ela existe para pegar é justamente o destino
    // que IGNORA o parâmetro — foi o BLOCKER do M22, onde o produtor escrevia `?prompt=` e o
    // consumidor nunca lia, com todos os testes de unidade verdes.
    //
    // Os números vêm da corrida real no `app-dev` (2026-08-05): durações de 1 a 17 ms, sem modelo,
    // sem tokens e sem custo — resolver um prompt não chama modelo. É o que torna as três colunas
    // escondidas pelo link uma decisão medida, e não estética.
    registerRoute('GET', `${prefix}/v1/dashboard/lens/traces`, async (req) => {
      const sp = new URL(req.url).searchParams;
      const casa = /^attr:prompt\.id=(.+)$/.exec(sp.get('span_query') ?? '');
      const resolution = (id: string, ms: number) => ({
        traceId: id,
        name: 'prompt.resolve',
        status: 'OK',
        statusCode: 'OK',
        durationMs: ms,
        startTimeUnixNano: '1785000000000000000',
      });
      if (casa) {
        // O VALOR importa, não só a presença do filtro. A primeira versão capturava o nome no
        // grupo 1 e NUNCA o usava: qualquer `prompt.id` devolvia as mesmas três linhas, e a
        // metade "e de nenhum outro" do DoD ficava provada só no endereço. Um mock que aceita
        // qualquer valor não discrimina — ele concorda.
        //
        // `despedida` tem uso na aba mas NENHUMA resolução aqui, de propósito: é o contraste que
        // a jornada percorre para provar que o destino filtra de verdade.
        if (casa[1] !== 'saudacao') {
          return Response.json({ traces: [], total: 0, limit: 50, offset: 0 });
        }
        const traces = [
          resolution('b8596693b566091c223ddc5e200e556e', 6),
          resolution('5a75856a2739f58e6960cc28a08949dd', 15),
          resolution('9bd90e39fb31648c9507e7ebdc62a564', 11),
        ];
        return Response.json({ traces, total: traces.length, limit: 50, offset: 0 });
      }
      // `session-detail.tsx` chama esta MESMA rota com `session_id` e nunca com `span_query`.
      // Alimentá-la com a lista genérica seria mentir com aparência de dado — o caso que este
      // arquivo já nomeia 30 linhas acima, a propósito da regressão de webhooks do M22.
      if (sp.get('session_id') !== null) {
        return Response.json({ traces: [], total: 0, limit: 50, offset: 0 });
      }
      // Sem filtro: a lista do workspace, que inclui o que NÃO é resolução de prompt.
      return Response.json({
        traces: [
          { traceId: 'aaaa1111bbbb2222cccc3333dddd4444', name: 'chat.completion', status: 'OK', statusCode: 'OK', model: 'claude-opus-5', durationMs: 1840, totalTokens: 512, costUsd: 0.0123 },
          resolution('b8596693b566091c223ddc5e200e556e', 6),
        ],
        total: 2, limit: 50, offset: 0,
      });
    });
    registerRoute('GET', `${prefix}/v1/dashboard/lens/metrics/span-attributes`, async () =>
      Response.json({ mode: 'keys', keys: [{ key: 'prompt.id', count: 9 }] }),
    );
    registerRoute('GET', `${prefix}/v1/dashboard/lens/usage-by-user`, async (req) => {
      const days = Number(new URL(req.url).searchParams.get('days') ?? 30);
      // O teto de 365 é o do serviço, que RECUSA acima dele com 400 tipado (M140) e o BFF
      // atravessa verbatim (M141). O mock recusa igual — senão a tela de erro nunca é exercitável
      // sem backend, e a conquista das duas milestones fica sem prova pelo lado do navegador.
      if (days > 365) {
        return Response.json(
          { code: 'INVALID_QUERY', message: 'days must be at most 365' },
          { status: 400 },
        );
      }
      // M144 — a série só vem quando pedida, como no serviço real (ADR-3 do M143). O dia 21 está
      // AUSENTE de propósito no maior consumidor: é a lacuna que o e2e afirma, e sem ela o spec
      // ficaria verde sobre uma linha contínua.
      const bucket = new URL(req.url).searchParams.get("bucket");
      if (bucket !== "day") return Response.json({ ...USAGE_BY_USER, windowDays: days });

      const day = (n: number) => new Date(Date.UTC(2026, 6, n)).toISOString();
      const ponto = (n: number, i: number, o: number, c: number) => ({
        periodStart: day(n), inputTokens: i, outputTokens: o,
        cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: c,
      });
      return Response.json({
        ...USAGE_BY_USER,
        windowDays: days,
        users: USAGE_BY_USER.users.map((u, idx) => ({
          ...u,
          series: idx === 0
            ? [ponto(20, 100, 40, 1.5), ponto(22, 300, 60, 2.5)] // dia 21 ausente — A LACUNA
            : [ponto(20, 10, 5, 0.1), ponto(21, 20, 6, 0.2), ponto(22, 30, 7, 0.3)],
        })),
      });
    });
  }
}
