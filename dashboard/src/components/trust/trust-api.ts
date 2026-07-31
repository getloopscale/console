import { cloudFetch } from '@/lib/api';

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
 */
const BASE = '/v1/dashboard/trust';

export function fetchTrust<T>(resource: string): Promise<T | null> {
  return cloudFetch<T>(`${BASE}${resource}`, {}, { throwOnError: true });
}
