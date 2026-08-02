import { cloudFetch } from '@/lib/api';

/**
 * M26 — o único ponto por onde as telas de skills falam com o BFF.
 *
 * Existe pela mesma razão de `trust-api.ts`: `throwOnError: true` NÃO pode ser uma decisão
 * repetida em cada chamada, porque decisão repetida é decisão esquecível numa. Sem ela, um erro
 * do backend resolve para `null` e a tela desenha um acervo VAZIO — "não há skills" onde o certo
 * era "não consegui perguntar". As duas frases levam o operador a ações opostas.
 *
 * O prefixo também vive aqui: as telas nomeiam o recurso, não a rota do BFF.
 */
const BASE = '/v1/dashboard/skills';

/** O acervo do inquilino. `limit` explícito: sem ele herdaríamos o teto do servidor sem saber qual é. */
export function fetchSkills<T>(limit: number): Promise<T | null> {
  return cloudFetch<T>(`${BASE}?limit=${encodeURIComponent(String(limit))}`, {}, { throwOnError: true });
}

export function fetchSkill<T>(id: string): Promise<T | null> {
  return cloudFetch<T>(`${BASE}/${encodeURIComponent(id)}`, {}, { throwOnError: true });
}

export function fetchSkillVersions<T>(id: string): Promise<T | null> {
  return cloudFetch<T>(`${BASE}/${encodeURIComponent(id)}/versions`, {}, { throwOnError: true });
}

export function fetchSkillChannels<T>(id: string): Promise<T | null> {
  return cloudFetch<T>(`${BASE}/${encodeURIComponent(id)}/channels`, {}, { throwOnError: true });
}

/** A instrução resolvida — o texto que um agente de fato carregaria. Fim da jornada de leitura. */
export function fetchSkillInstructions<T>(id: string): Promise<T | null> {
  return cloudFetch<T>(`${BASE}/${encodeURIComponent(id)}/instructions`, {}, { throwOnError: true });
}
