import { cloudFetch } from '@/lib/http/api';
import { LIST_SAFETY_CEILING } from '@/lib/http/list-ceiling';

/**
 * O transporte do domínio de traces (B-012).
 *
 * ## A exportação era a única chamada sem `throwOnError`, e falhava calada
 *
 * `buscarParaExportar` abaixo era um `cloudFetch` cru dentro do handler de
 * exportação, sem a flag. Sem ela o helper **resolve para `null`** em qualquer
 * 4xx/5xx, e a linha seguinte era `res?.traces ?? []` — a falha virava lista
 * vazia, o `catch` nunca era alcançado, e a tela anunciava:
 *
 *     "Exported 0 traces."
 *
 * Uma mensagem de sucesso, com um número, para uma exportação que não
 * aconteceu. Quem lê conclui que o filtro não casou nada e vai mexer no filtro.
 *
 * É a mesma classe do `#274` que `silent-null-guard.test.ts` fecha — mas o
 * guard quantifica sobre `useQuery`, e este era um `await` solto num handler.
 * Por isso ficou de fora: o defeito não estava na forma que o guard vigia.
 */

/**
 * A forma de fio de uma linha de trace.
 *
 * Todo campo numérico é opcional de propósito (M59 P1): ausente vira travessão
 * na tela, nunca zero. Fabricar um número num painel de observabilidade é pior
 * que não mostrar nada — quem lê `0 ms` acredita.
 */
export interface Trace {
  traceId: string;
  name?: string;
  status?: string;
  statusCode?: string;
  model?: string;
  startTimeUnixNano?: string;
  // M59 P1 — consensus-spine numeric fields (all optional; absent → em-dash, never fabricated).
  durationMs?: number;
  costUsd?: number;
  totalTokens?: number;
  sessionId?: string;
  // M78 — per-trace count of machine evaluations (from the list read's `evaluationsCount`, O(1) subquery;
  // omitted when 0). Makes scored traces findable in the list without opening each one.
  evaluationsCount?: number;
}

export interface TracesResult {
  traces: Trace[];
  /** M81 — envelope de paginação do servidor (total do workspace + a janela aplicada). */
  total?: number;
  limit?: number;
  offset?: number;
}

export interface ChaveDeAtributo {
  key: string;
  count: number;
}

/** A janela da página de traces. */
export const TRACES_PAGE_SIZE = 50;

export function listar(queryString: string) {
  return cloudFetch<TracesResult>(
    `/v1/dashboard/lens/traces${queryString}`,
    {},
    { throwOnError: true },
  );
}

/**
 * A mesma listagem, para a exportação.
 *
 * Separada de `listar` porque o chamador é outro — a exportação pagina até o
 * teto por conta própria — e porque o tipo de retorno dela é só o array. O que
 * NÃO muda entre as duas é a flag.
 */
export async function buscarParaExportar(queryString: string): Promise<Trace[]> {
  const res = await cloudFetch<{ traces: Trace[] }>(
    `/v1/dashboard/lens/traces${queryString}`,
    {},
    { throwOnError: true },
  );
  return res?.traces ?? [];
}

export function chavesDeAtributo() {
  return cloudFetch<{ mode: 'keys'; keys: ChaveDeAtributo[] }>(
    `/v1/dashboard/lens/metrics/span-attributes?limit=${LIST_SAFETY_CEILING}`,
    {},
    { throwOnError: true },
  );
}

/**
 * Cria um dataset de regressão a partir dos traces selecionados.
 *
 * Reaproveita as rotas de dataset do M44 — não há código de dataset novo aqui,
 * e é por isso que são duas chamadas em sequência em vez de um endpoint.
 */
export async function criarDatasetDeRegressao(
  traceIds: string[],
  nome: string,
): Promise<string> {
  const ds = await cloudFetch<{ id: string }>(
    '/v1/dashboard/lens/datasets',
    { method: 'POST', body: JSON.stringify({ name: nome }) },
    { throwOnError: true },
  );
  for (const traceId of traceIds) {
    await cloudFetch(
      `/v1/dashboard/lens/datasets/${encodeURIComponent(ds!.id)}/items`,
      { method: 'POST', body: JSON.stringify({ traceId }) },
      { throwOnError: true },
    );
  }
  return ds!.id;
}
