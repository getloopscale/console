import { cloudFetch, ApiError } from '@/lib/api';

/**
 * M25 — o único ponto por onde as telas de prompts falam com o BFF.
 *
 * Existe pela mesma razão de `skills-api.ts` e `trust-api.ts`: `throwOnError: true` NÃO pode ser
 * decisão repetida em cada chamada, porque decisão repetida é decisão esquecível numa. Sem ela um
 * erro do backend resolve para `null` e a tela desenha um catálogo VAZIO — "não há prompts" onde o
 * certo era "não consegui perguntar". As duas frases levam o operador a ações opostas.
 */
const BASE = '/v1/dashboard/promptly';

/** O índice do inquilino. `limit` explícito: sem ele herdaríamos o teto do servidor sem saber qual é. */
export function fetchCatalog<T>(limit: number): Promise<T | null> {
  return cloudFetch<T>(`${BASE}/prompts?limit=${encodeURIComponent(String(limit))}`, {}, { throwOnError: true });
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
