import { cloudFetch } from '@/lib/http/api';
import { LIST_SAFETY_CEILING } from '@/lib/http/list-ceiling';

/**
 * O transporte do domínio de chaves de API.
 *
 * ## `throwOnError` não é opcional em nenhuma destas chamadas
 *
 * `cloudFetch` chama a flag de "opt-in", e a doc dela é sobre não quebrar
 * chamadores antigos — não sobre a chamada ser segura sem ela. Sem a flag o
 * helper **resolve para `null`** num 4xx, o React Query trata isso como
 * sucesso, e o `onSuccess` do chamador roda.
 *
 * Medido ao vivo em 2026-08-01 (`LT-019`): um `400 UNKNOWN_SCOPE` fechou o
 * diálogo de criação sem mensagem alguma, e o operador saiu convencido de ter
 * criado uma chave que o backend recusou.
 *
 * Numa superfície de segurança isso é a pior mentira possível, e cada função
 * abaixo erra de um jeito próprio se a flag cair:
 *
 * - `criar` — o diálogo fecha e a chave não existe.
 * - `revogar` — a chave some da lista como se tivesse sido revogada, e continua
 *   valendo.
 * - `rotacionar` — o diálogo de segredo abre com `null`, e quem confiou nele
 *   perdeu a chave antiga sem receber a nova.
 *
 * Elas moram juntas aqui para que a flag seja uma propriedade do MÓDULO, e não
 * uma lembrança de quem escreve a próxima chamada.
 */

/**
 * Espelha o que `GET /v1/api-keys/list` devolve — ver `APIKeyView` em
 * `cloud/internal/routes/api_keys.go`. Os nomes em snake_case são os das tags
 * JSON do Go, mantidos literais para não haver tradução no meio.
 */
export interface APIKeyView {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at?: string | null;
  expires_at?: string | null;
}

export interface CreateKeyResponse {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  /** O segredo cru — mostrado UMA vez; nunca devolvido de novo. */
  secret: string;
}

export interface ListKeysResponse {
  keys: APIKeyView[];
}

export interface LineageItem {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  revoked_at?: string | null;
  expires_at?: string | null;
  is_current: boolean;
}

export interface LineageResult {
  lineage: LineageItem[];
}

export interface NovaChave {
  name: string;
  scopes: string[];
  expires_at?: string | null;
}

export function listar() {
  return cloudFetch<ListKeysResponse>(
    `/v1/api-keys/list?limit=${LIST_SAFETY_CEILING}`,
    {},
    { throwOnError: true },
  );
}

export function linhagem(id: string) {
  return cloudFetch<LineageResult>(`/v1/api-keys/${id}/lineage`, {}, { throwOnError: true });
}

export function criar(input: NovaChave) {
  return cloudFetch<CreateKeyResponse>(
    '/v1/api-keys',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    { throwOnError: true },
  );
}

export function revogar(id: string) {
  return cloudFetch<null>(`/v1/api-keys/${id}`, { method: 'DELETE' }, { throwOnError: true });
}

export function rotacionar(id: string) {
  return cloudFetch<CreateKeyResponse>(
    `/v1/api-keys/${id}/rotate`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    },
    { throwOnError: true },
  );
}
