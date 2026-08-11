import { ApiError, cloudFetch } from '@/lib/http/api';

/**
 * M23 — o único ponto por onde as telas de trust falam com o BFF.
 *
 * Existe para que `throwOnError: true` NÃO seja uma decisão repetida em cada chamada — e portanto
 * esquecível numa. Sem ela, um erro do backend resolve para `null` e a tela desenha zeros
 * fabricados: um painel de segurança relatando "nenhuma violação" durante uma indisponibilidade.
 * Num painel de confiança, o falso negativo é o pior modo de falha, e ele nasce exatamente de uma
 * chamada que alguém escreveu sem a flag.
 *
 * O prefixo também vive aqui: as telas nomeiam o recurso, não a rota do BFF.
 *
 * M24 acrescenta os verbos de gestão de guardrail. A regra nova é `serviceMessage`: o `theo-trust`
 * devolve códigos tipados (`INVALID_SPEC`, `VALIDATOR_NAME_RESERVED`, `CONFLICT`) com uma frase que
 * diz ao operador o que corrigir. Se essa frase virar "ocorreu um erro" em qualquer ponto do
 * caminho, ele tenta de novo exatamente igual — e é por isso que a extração vive aqui, uma vez, e
 * não em cada tela.
 */
const BASE = '/v1/dashboard/trust';

export function fetchTrust<T>(resource: string): Promise<T | null> {
  return cloudFetch<T>(`${BASE}${resource}`, {}, { throwOnError: true });
}

/** Auditoria do enforcement inline. O `limit` é explícito: sem ele herdaríamos o teto do servidor sem saber. */
export function fetchEnforcementEvents<T>(limit: number): Promise<T | null> {
  return fetchTrust<T>(`/enforcement-events?limit=${encodeURIComponent(String(limit))}`);
}

/** Catálogo mesclado plataforma + tenant. */
export function fetchValidators<T>(): Promise<T | null> {
  return fetchTrust<T>('/validators');
}

/** Dry-run: avalia a spec candidata SEM gravar nada. Rota própria, não flag do create. */
export function testGuardrail<T>(body: unknown): Promise<T | null> {
  return mutate<T>('/guardrails/test', 'POST', body);
}

/** Grava a guardrail. Só deve ser chamada depois de um dry-run da MESMA spec. */
export function createGuardrail<T>(body: unknown): Promise<T | null> {
  return mutate<T>('/guardrails/', 'POST', body);
}

/** Remove uma guardrail do tenant. Irreversível pela UI — a tela exige confirmação digitada. */
export function deleteGuardrail(id: string): Promise<unknown> {
  return mutate<unknown>(`/guardrails/${encodeURIComponent(id)}`, 'DELETE');
}

function mutate<T>(resource: string, method: 'POST' | 'DELETE', body?: unknown): Promise<T | null> {
  return cloudFetch<T>(
    `${BASE}${resource}`,
    {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    },
    { throwOnError: true },
  );
}

/**
 * A frase que o operador lê quando o serviço recusa.
 *
 * Preferimos SEMPRE o texto do serviço: ele nomeia o campo e o motivo ("terms must not be empty"),
 * enquanto qualquer texto nosso seria uma paráfrase que envelhece. O fallback existe só para o caso
 * em que não veio corpo tipado — e ele diz o que houve, não "erro".
 */
export function serviceMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;

  const body = err.body;
  if (body && typeof body === 'object') {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return err.status === 0 ? 'Could not reach the server.' : fallback;
}

/** O código tipado do serviço, quando houver — a tela usa para escolher o texto de apoio. */
export function serviceCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body;
  if (body && typeof body === 'object') {
    const code = (body as { code?: unknown }).code;
    if (typeof code === 'string' && code !== '') return code;
  }
  return null;
}
