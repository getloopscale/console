import { cloudFetch, ApiError } from '@/lib/api';
import { temProximaPagina } from './projections';

/**
 * M25 — o único ponto por onde as telas de prompts falam com o BFF.
 *
 * Existe pela mesma razão de `skills-api.ts` e `trust-api.ts`: `throwOnError: true` NÃO pode ser
 * decisão repetida em cada chamada, porque decisão repetida é decisão esquecível numa. Sem ela um
 * erro do backend resolve para `null` e a tela desenha um catálogo VAZIO — "não há prompts" onde o
 * certo era "não consegui perguntar". As duas frases levam o operador a ações opostas.
 */
const BASE = '/v1/dashboard/promptly';

/**
 * Explícito de propósito: sem `limit` herdaríamos o teto do servidor sem saber qual é.
 *
 * Vive AQUI, junto do fetcher, e não em cada tela. Duas telas do mesmo recurso podem divergir no
 * limite sem que nada acuse — e o limite é insumo direto da parcialidade.
 */
export const CATALOG_PAGE_LIMIT = 100;

/** A chave de cache do catálogo — uma só, porque o recurso é um só. */
export const CATALOG_QUERY_KEY = ['cloud', '/v1/dashboard/promptly/prompts'] as const;

/** Uma página do catálogo mais a informação de que ela pode não ser tudo. */
export interface CatalogPage<T> {
  readonly data: T | null;
  /** O serviço sinalizou próxima página (`Link … rel="next"`). */
  readonly temContinuacao: boolean;
}

/**
 * M13 — o índice E o sinal de continuação, que só o header carrega.
 *
 * **Um fetcher só, para um recurso só.** A primeira versão deste milestone acrescentou este ao lado
 * do `fetchCatalog` antigo e deixou a tela de lista no antigo — que descarta o header. O resultado
 * foi a lista afirmando um total sobre uma página capada, exatamente o defeito que o painel foi
 * construído para não cometer. Dois fetchers para o mesmo recurso não são redundância inofensiva:
 * eles divergem, e a divergência aparece como duas telas dizendo coisas diferentes sobre o mesmo
 * dado.
 *
 * **O sinal chega por `onResponse`, e não por `cloudFetchRaw`, e a diferença é de segurança.**
 * `cloudFetchRaw` dá acesso à resposta mas NÃO reproduz o refresh-e-retry no 401, o interceptor de
 * 402 nem o erro tipado de rede — a tela que o usasse quebraria numa expiração de sessão onde a
 * tela vizinha se recupera sozinha, sobre o mesmo recurso. O callback mantém UM pipeline de auth.
 */
export async function fetchCatalogPage<T>(limit: number): Promise<CatalogPage<T>> {
  let temContinuacao = false;
  const data = await cloudFetch<T>(
    `${BASE}/prompts?limit=${encodeURIComponent(String(limit))}`,
    {},
    {
      throwOnError: true,
      onResponse: (resp) => {
        temContinuacao = temProximaPagina(resp.headers.get('Link'));
      },
    },
  );
  return { data, temContinuacao };
}

/**
 * As revisões de um prompt, com limite PEQUENO e EXPLÍCITO.
 *
 * Medido: cada item desta lista carrega o `content` integral da revisão, e o serviço aplica um
 * default de 100 quando ninguém pede. A tela quer desenhar uma lista de versões, não baixar o
 * histórico inteiro — por isso o limite é argumento obrigatório aqui, e não um opcional que alguém
 * esquece de passar.
 */
export function fetchRevisions<T>(name: string, limit: number, after = 0): Promise<T | null> {
  const q = new URLSearchParams({ limit: String(limit) });
  // `after` posiciona a janela no FIM do histórico. A rota ordena da revisão mais antiga para a
  // mais nova, então sem cursor `limit=10` devolve as 10 mais ANTIGAS — e esta é a tela de onde
  // sai a promoção (#364).
  if (after > 0) q.set('after', String(after));
  return cloudFetch<T>(`${BASE}/prompts/${encodeURIComponent(name)}/revisions?${q}`, {}, { throwOnError: true });
}

/** O prompt resolvido — usado para saber qual é a ÚLTIMA revisão antes de pedir a janela. */
export function fetchPrompt<T>(name: string): Promise<T | null> {
  return cloudFetch<T>(`${BASE}/prompts/${encodeURIComponent(name)}`, {}, { throwOnError: true });
}

/** Para onde cada label de ambiente aponta HOJE — o dado que a confirmação da promoção consome. */
export function fetchLabels<T>(name: string): Promise<T | null> {
  return cloudFetch<T>(`${BASE}/prompts/${encodeURIComponent(name)}/labels`, {}, { throwOnError: true });
}

/**
 * A política que governa a promoção de um label.
 *
 * `404` NÃO é falha aqui: é o fato "nenhuma regra governa este label", e a tela renderiza
 * *promoção livre*. Confundi-lo com "não consegui ler" faria a tela avisar sobre uma restrição
 * que não existe — ou esconder uma que existe. Por isso o 404 vira `null` e qualquer outro erro
 * continua subindo.
 */
export async function fetchPolicy<T>(name: string, label: string): Promise<T | null> {
  const path = `${BASE}/prompts/${encodeURIComponent(name)}/policies/${encodeURIComponent(label)}`;
  try {
    return await cloudFetch<T>(path, {}, { throwOnError: true });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Promove: reponta `label` para `version`.
 *
 * O ato mais perigoso do produto — troca, sem redeploy, o prompt que agentes em execução
 * resolvem. Um clique errado não derruba nada: muda comportamento em silêncio.
 */
export function promoteLabel<T>(name: string, label: string, version: number): Promise<T | null> {
  const path = `${BASE}/prompts/${encodeURIComponent(name)}/labels/${encodeURIComponent(label)}`;
  return cloudFetch<T>(
    path,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }) },
    { throwOnError: true },
  );
}

/**
 * M12 — cria uma revisão nova (`version = max+1`). Serve tanto prompt novo quanto revisão de um
 * existente: `POST /prompts` aceita os dois (medido), e um segundo fluxo seria uma tela a mais
 * sem uma regra a mais.
 *
 * O nome é validado ANTES daqui, na tela: `POST` aceita `time/saudacao` (201) mas a leitura só
 * responde com `%2F`, e há intermediários (mux Go, Traefik) cujo tratamento de barra codificada
 * eu não medi. A tela é mais estrita que a API de propósito.
 */
export function createRevision<T>(name: string, content: string): Promise<T | null> {
  return cloudFetch<T>(
    `${BASE}/prompts`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, content }) },
    { throwOnError: true },
  );
}

/**
 * Reverte: cria revisão nova com o conteúdo de `toVersion` e, se `label` for dado, reponta esse
 * label para ela.
 *
 * `label` é OPCIONAL na API e a diferença é visível ao operador: sem ele, um prompt sem labels
 * responde `201` com `labelsMoved: []` — revisão criada, produção intacta. Por isso a tela nunca
 * declara sucesso a partir do status; ela lê `labelsMoved` (ver `rollback.ts`).
 */
export function rollbackPrompt<T>(name: string, toVersion: number, label?: string): Promise<T | null> {
  const corpo: { toVersion: number; label?: string } = { toVersion };
  if (label) corpo.label = label;
  return cloudFetch<T>(
    `${BASE}/prompts/${encodeURIComponent(name)}/rollback`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) },
    { throwOnError: true },
  );
}
