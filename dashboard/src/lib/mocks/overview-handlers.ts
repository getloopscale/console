import { registerRoute } from './server';

/**
 * Os quatro agregados de capacidade que nenhum mock servia (B-112, decisão D5 de
 * `platform-overview-plan.md`).
 *
 * ## O que faltava, e como isso ficou invisível
 *
 * `memory/metrics`, `rag/analytics`, `lens/observability` e `storage/usage` são consumidos pelas
 * páginas de capacidade desde sempre — e nunca tiveram handler. Em modo mock elas escapavam para
 * o proxy do Vite e voltavam 500, então as telas de Memory, Knowledge Base, Observability e
 * Workspace mostravam "não foi possível carregar" no ambiente onde o produto é validado.
 *
 * Ficou invisível porque cada uma dessas telas trata a falha corretamente: mostra o estado de
 * erro, não quebra. Um e2e que afirma heading fica verde sobre uma tela que não carregou nada —
 * o mesmo defeito que `lens-handlers.ts` documenta no seu topo, quatro capacidades adiante.
 *
 * A Overview de plataforma é o que tornou o custo grande demais para adiar: ela lê as OITO de uma
 * vez, e sem estes handlers metade dos cards diria "couldn't load". A DoD do item exige que
 * "não consegui ler" e "não adotada" sejam distinguíveis — e num ambiente onde quatro capacidades
 * só sabem falhar, quem valida não distingue produto de ambiente.
 *
 * ## Por que estático
 *
 * Como em `lens-handlers.ts`: não há jornada de escrita a provar. São relatórios derivados, e a
 * tela é somente leitura. Um mock mutável seria maquinário que ninguém pediu.
 *
 * ## Por que os números não são zero
 *
 * Um fixture zerado deixa cada card em "not set up yet" e torna o estado `em-uso` — o que o dono
 * quer ver ao validar — inexercitável sem backend. `overview-handlers.test.ts` afirma `em-uso`
 * para cada rota exatamente por isso.
 */

/** O prefixo depende de `window.__THEO_CONFIG__.API_URL`: vazio em dev, `/api` atrás do proxy. */
const PREFIXOS = ['', '/api'] as const;

/**
 * As formas são as das interfaces que as páginas já declaram, não inventadas aqui:
 * `MemoryMetrics` (`pages/memory/overview.tsx:27`), `AnalyticsResult`
 * (`pages/rag/analytics.tsx:20`), `ObservabilityResult` (`pages/lens/overview.tsx:36`) e
 * `UsageInfo` (`pages/workspace/overview.tsx:58`). Um mock com a forma errada é pior que nenhum:
 * ele passa por dado e falha no consumidor.
 */
const MEMORY_METRICS = {
  total_memories: 1284,
  retrieval_api_usage: 9317,
  add_events: 1502,
  entity_count: 431,
};

const RAG_ANALYTICS = {
  window: { since: '2026-07-11T00:00:00Z' },
  totals: { retrievals: 3921, answers: 3608, empty_retrieval_rate: 0.037 },
  latency: { p50_ms: 88, p95_ms: 412 },
  confidence: { high: 2711, medium: 764, low: 133 },
};

const STORAGE_USAGE = {
  used_bytes: 734_003_200,
  aggregate_limit: 5_000_000_000,
  tier: 'pro',
  unlimited: false,
};

/** Doze horas de tráfego. A série existe para que a capacidade leia como adotada, não para gráfico. */
function serieDeObservabilidade() {
  const horas = Array.from({ length: 12 }, (_, i) =>
    new Date(Date.UTC(2026, 7, 10, i)).toISOString(),
  );
  return {
    range: '24h',
    traffic: horas.map((periodStart, i) => {
      const traceCount = 120 + i * 17;
      const errorCount = i % 4 === 0 ? 3 : 1;
      return { periodStart, traceCount, errorCount, errorRate: errorCount / traceCount };
    }),
    latency: horas.map((periodStart, i) => ({
      periodStart,
      p50Ms: 74 + i,
      p95Ms: 380 + i * 4,
      p99Ms: 910 + i * 9,
    })),
    tokensByModel: horas.flatMap((periodStart, i) => [
      { periodStart, model: 'claude-opus-5', totalTokens: 8400 + i * 210, costUsd: 0.42 + i * 0.01 },
      { periodStart, model: 'claude-haiku-4-5', totalTokens: 3100 + i * 90, costUsd: 0.03 },
    ]),
  };
}

export function registerOverviewHandlers() {
  for (const prefix of PREFIXOS) {
    const base = `${prefix}/v1/dashboard`;

    registerRoute('GET', `${base}/memory/metrics`, async () => Response.json(MEMORY_METRICS));

    registerRoute('GET', `${base}/rag/analytics`, async () => Response.json(RAG_ANALYTICS));

    registerRoute('GET', `${base}/storage/usage`, async () => Response.json(STORAGE_USAGE));

    // O `range` é atravessado verbatim, como o serviço faz. A Overview de plataforma não manda
    // `range` (ela não deixa o usuário escolher janela, e publicar um número cuja janela ninguém
    // declarou é o defeito que `tabs/producao.tsx` documenta); a página do Lens manda.
    registerRoute('GET', `${base}/lens/observability`, async (req) => {
      const range = new URL(req.url).searchParams.get('range');
      const serie = serieDeObservabilidade();
      return Response.json(range ? { ...serie, range } : serie);
    });
  }
}
