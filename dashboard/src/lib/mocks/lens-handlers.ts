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
      const corpo = (await req.json()) as Record<string, unknown>;
      const regra = {
        id: `lar-${regrasDeAlerta.length + 1}`,
        enabled: true,
        status: 'OK',
        // `null` é "ainda não avaliado" — distinto de "sem dados". É o quarto DoD do M22, e a
        // distinção que impede o operador de concluir que a regra falhou e criar a segunda.
        last_evaluated_at: null,
        last_triggered_at: null,
        ...corpo,
      };
      regrasDeAlerta.push(regra);
      return Response.json(regra);
    });
    registerRoute('GET', `${prefix}/v1/settings/webhooks/list`, async () =>
      Response.json({ webhooks: [{ id: 'wwh-1', label: 'prod hook' }] }),
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

      const dia = (n: number) => new Date(Date.UTC(2026, 6, n)).toISOString();
      const ponto = (n: number, i: number, o: number, c: number) => ({
        periodStart: dia(n), inputTokens: i, outputTokens: o,
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
