import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { cloudFetch } from '@/lib/http/api';

/**
 * use-service-versions (M21) — the dashboard's view of the data-plane versions
 * aggregated by the gateway BFF `GET /v1/dashboard/status/versions`.
 *
 * The union below is STRICT (plan ADR D3/D6): `version` exists ONLY on the `ok`
 * variant, so a degraded service cannot show a stale version — the compiler
 * forbids reaching `s.version` before narrowing by `s.state === 'ok'`. This is
 * deliberately unlike `use-metrics-range.ts:49-55`, which carries `data` next to
 * `status` and stays honest only by discipline.
 */
export type ServiceStatus =
  | { readonly name: string; readonly state: 'ok'; readonly checked_at: string; readonly version: string; readonly built_at?: string }
  | { readonly name: string; readonly state: 'unreachable'; readonly checked_at: string; readonly reason: string }
  | { readonly name: string; readonly state: 'timeout'; readonly checked_at: string; readonly reason?: string }
  | { readonly name: string; readonly state: 'not_deployed'; readonly checked_at: string }
  // #345 — o alvo RESPONDEU e recusou o probe (401/403). Nao e degradacao: e ausencia de
  // medicao. Separado de `unreachable` porque o servico esta de pe — o que faltou foi
  // credencial —, e colapsar os dois pintava o indicador de vermelho permanente.
  | { readonly name: string; readonly state: 'unauthorized'; readonly checked_at: string; readonly reason: string }
  // O alvo RESPONDEU com payload bem formado declarando que NAO sabe a propria build
  // (os sentinelas do contrato: `dev` para version, `unknown` para o resto). Nao e
  // degradacao — o servico esta de pe — e nao e saude — nao houve medicao de versao.
  // Sem `version` no tipo: uma tela que tentasse exibir versao aqui nao compila.
  | { readonly name: string; readonly state: 'no_provenance'; readonly checked_at: string; readonly reason: string };

/**
 * The one path the gateway mounts (`internal/routes/service_versions.go`).
 *
 * It is a named export so a test can hold BOTH sides of the contract at once: the
 * Go suite asserts the chi route and this suite mocks the transport wholesale, so
 * until `use-service-versions.test.ts` read the Go source, a typo on either side
 * kept every test green and 404'd on the first load (F-test-1).
 */
export const SERVICE_VERSIONS_PATH = '/v1/dashboard/status/versions';

export interface ServiceVersionsReport {
  readonly collected_at: string;
  readonly services: readonly ServiceStatus[];
}

/** The three levels the footer dot can show. */
export type AggregateState = 'operational' | 'degraded' | 'unknown';

/**
 * Reduce N service states into the footer verdict — by ALLOWLIST, never by
 * exclusion (ADR D9). Green requires proof:
 *
 *  - nothing to read (missing/empty list)          → `unknown`
 *  - every target merely `not_deployed`            → `unknown` (nothing is down,
 *    but nothing is up either — no measured health to claim)
 *  - anything outside `{ok, not_deployed}`         → `degraded`, which also covers
 *    a state this union does not know, because the payload comes from the wire
 *    and not from the compiler
 *  - otherwise                                     → `operational`
 *
 * A lone `not_deployed` does NOT drag the dot to amber (ADR D7: `theo-storage` is
 * permanently absent in dev, and a permanent amber is a new constant lie), but it
 * no longer holds the green up on its own either (ADR D9).
 */
export function aggregateState(services: readonly ServiceStatus[] | undefined): AggregateState {
  if (!services || services.length === 0) return 'unknown';
  // Nada medido como saudavel => `unknown`, nunca verde. `no_provenance` entra junto de
  // `not_deployed` porque tambem NAO e evidencia de saude: o alvo respondeu, mas o que ele
  // respondeu foi "nao sei minha versao". Sem esta linha, uma frota inteira sem proveniencia
  // saia `operational` — verde afirmado sobre zero medicao, que e a mentira que o estado
  // novo existe para eliminar (pego pelo controle negativo em use-service-versions.test.ts).
  if (services.every((s) => s.state === 'not_deployed' || s.state === 'no_provenance')) return 'unknown';
  // `unauthorized` NAO arrasta o ponto para baixo, pelo mesmo motivo de `not_deployed` (ADR D7):
  // nenhum dos dois e EVIDENCIA de degradacao. Um indicador permanentemente vermelho e um
  // indicador desligado — o usuario aprende a ignora-lo, e quando algo degradar de verdade
  // ninguem olha. A visibilidade vem do censo em `describeStatus` (que o conta como `unknown`) e
  // da pagina /status, nao de pintar tudo de vermelho.
  // `no_provenance` entra na MESMA allowlist e pelo mesmo argumento: o alvo respondeu,
  // entao nao ha evidencia de degradacao. E o que preserva a intencao original da linha
  // self do theo-cloud (internal/routes/self_version_test.go) — um build sem carimbo nao
  // pode pintar o painel de ambar permanente — agora sem precisar que ela AFIRME uma
  // versao que nao tem.
  const measured = (s: ServiceStatus) =>
    s.state === 'ok' || s.state === 'not_deployed' || s.state === 'unauthorized' ||
    s.state === 'no_provenance';
  if (!services.every(measured)) return 'degraded';
  return 'operational';
}

/**
 * The accessible label, derived from counts — never a fixed sentence. This is what
 * keeps a `not_deployed` service visible to assistive technology even though it does
 * not drag the dot down (ADR D7 § Consequences). A `timeout` counts as unreachable so
 * the label never undercounts a failure.
 *
 * The counts are a CENSUS: they always sum to `services.length`. Enumerating only the
 * four known states left a state outside the union in no bucket at all, so the same
 * payload that `aggregateState` turns amber announced an all-clear to assistive
 * technology (F-web-1) — the indicator's lie relocated from the visual channel into
 * the one channel that cannot be double-checked by looking. The residual bucket is
 * derived by subtraction for the same reason `aggregateState` is an allowlist: the
 * payload comes from the wire, not from the compiler (ADR D9).
 */
export function describeStatus(services: readonly ServiceStatus[]): string {
  const operational = services.filter((s) => s.state === 'ok').length;
  const unreachable = services.filter((s) => s.state === 'unreachable' || s.state === 'timeout').length;
  const notConfigured = services.filter((s) => s.state === 'not_deployed').length;
  const noProvenance = services.filter((s) => s.state === 'no_provenance').length;
  const unknown = services.length - operational - unreachable - notConfigured - noProvenance;
  // "not configured", nao "not deployed": o coletor mede base URL vazia, nao ausencia
  // de deploy. A imprecisao custa MAIS aqui do que na tabela — este e o unico canal
  // que o leitor nao consegue conferir olhando (o mesmo argumento que o F-web-1 usou
  // para tornar as contagens um censo).
  const counted = `System status: ${operational} operational, ${unreachable} unreachable, ${notConfigured} not configured, ${noProvenance} without provenance`;
  return unknown > 0 ? `${counted}, ${unknown} unknown` : counted;
}

/**
 * One query for the whole aggregate (ADR D2) — the fan-out lives in the gateway,
 * not in the browser.
 *
 * This hook overrides NO cache policy on purpose: the global client already sets one
 * (`lib/query-client.ts:39-42`), and the staleness window that follows from it is an
 * ACCEPTED, documented risk (plan § R7) rather than something silently tightened here.
 *
 * `throwOnError` IS overridden, and deliberately: under the default contract every
 * 5xx and every network rejection RESOLVES `null`, so the query SUCCEEDS holding
 * nothing — a failed read becomes indistinguishable from a pending one, and the
 * retry guard in `lib/query-client.ts:20-36` never sees a failure to retry. Opting
 * in makes a failure an `isError`, which is the only thing the footer can tell
 * apart from "still loading" (F-web-2). Repo precedent: `pages/memory/graph.tsx:487`
 * and `pages/memory/webhooks.tsx:101` opted in for the same reason.
 */
export function useServiceVersions(): UseQueryResult<ServiceVersionsReport | null> {
  return useQuery({
    queryKey: ['dashboard', 'status', 'versions'],
    queryFn: () => cloudFetch<ServiceVersionsReport>(SERVICE_VERSIONS_PATH, {}, { throwOnError: true }),
  });
}
