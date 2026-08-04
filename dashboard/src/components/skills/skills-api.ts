import { ApiError, cloudFetch } from '@/lib/api';

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

/**
 * Promove um canal para outra revisão — a ÚNICA escrita desta capacidade.
 *
 * Vai por `PUT` no caminho do canal, com `revision_id` no corpo: a forma medida no contrato do
 * BFF, que por sua vez espelha a do registro. O BFF usa um cliente com credencial própria
 * (`skills:publish`); o de leitura não consegue executar isto, e é assim de propósito.
 */
export function promoteChannel<T>(skillId: string, channel: string, revisionId: string): Promise<T | null> {
  return cloudFetch<T>(
    `${BASE}/${encodeURIComponent(skillId)}/channels/${encodeURIComponent(channel)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision_id: revisionId }),
    },
    { throwOnError: true },
  );
}

/**
 * A frase que o operador lê quando a promoção é recusada.
 *
 * Preferimos SEMPRE o texto do serviço: ele nomeia o motivo ("scope skills:publish required"),
 * enquanto qualquer paráfrase nossa envelhece. O fallback existe só para quando não veio corpo
 * tipado — e ele diz o que houve, não "erro".
 */
export function promotionRefusal(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  const body = err.body;
  if (body && typeof body === 'object') {
    const message = (body as { message?: unknown; details?: unknown }).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
    const details = (body as { details?: unknown }).details;
    if (typeof details === 'string' && details.trim() !== '') return details;
  }
  // 403 tem texto próprio: é a única recusa que o operador pode agir a respeito, e "tente de
  // novo" seria conselho errado — a credencial dele não vai mudar sozinha.
  if (err.status === 403) return 'Sua credencial não tem permissão para promover canais neste workspace.';
  return err.status === 0 ? 'Não foi possível falar com o servidor.' : fallback;
}

// ---- M35 — a superfície de DISTRIBUIÇÃO ------------------------------------------------------
//
// Prefixo próprio: o BFF expõe bundles como recurso IRMÃO de skills (`/v1/dashboard/bundles`), e
// não filho. Pendurá-los sob `/skills/` faria o roteador do backend tratar `bundles` como um
// identificador de skill — a mesma classe de defeito que derrubou a leitura de canais em produção.
const BUNDLES = '/v1/dashboard/bundles';

/** Os bundles do inquilino. */
export function fetchBundles<T>(): Promise<T | null> {
  return cloudFetch<T>(BUNDLES, {}, { throwOnError: true });
}

export function createBundle<T>(name: string): Promise<T | null> {
  return cloudFetch<T>(
    BUNDLES,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
    { throwOnError: true },
  );
}

/**
 * Os tokens delegados de um bundle.
 *
 * É a leitura que torna a revogação possível: o `DELETE` exige um identificador que, sem esta
 * lista, o operador não tem como descobrir — um token emitido pela CLI ou por outro operador seria
 * invisível e portanto irrevogável.
 *
 * A resposta traz identidade e ciclo de vida; **nunca o valor nem o hash**.
 */
export function fetchBundleTokens<T>(bundleId: string): Promise<T | null> {
  return cloudFetch<T>(`${BUNDLES}/${encodeURIComponent(bundleId)}/tokens`, {}, { throwOnError: true });
}

/**
 * Emite um token delegado. A resposta carrega o valor em claro **uma única vez**.
 *
 * Quem chama precisa mostrá-lo ao operador na hora e dizer que não reaparece — a listagem devolve
 * só o identificador, por desenho.
 */
export function mintBundleToken<T>(bundleId: string, ttlDays: number, label: string): Promise<T | null> {
  return cloudFetch<T>(
    `${BUNDLES}/${encodeURIComponent(bundleId)}/tokens`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl_days: ttlDays, ...(label !== '' ? { label } : {}) }),
    },
    { throwOnError: true },
  );
}

/** Revoga um token. Ele CONTINUA listado, com a marca — esconder impediria auditar o que foi emitido. */
export function revokeBundleToken<T>(bundleId: string, tokenId: string): Promise<T | null> {
  return cloudFetch<T>(
    `${BUNDLES}/${encodeURIComponent(bundleId)}/tokens/${encodeURIComponent(tokenId)}`,
    { method: 'DELETE' },
    { throwOnError: true },
  );
}

/** A adoção do bundle na janela, com o denominador (`total_installs`) que a proporção exige. */
export function fetchBundleAdoption<T>(bundleId: string, days: number): Promise<T | null> {
  return cloudFetch<T>(
    `${BUNDLES}/${encodeURIComponent(bundleId)}/adoption?days=${encodeURIComponent(String(days))}`,
    {},
    { throwOnError: true },
  );
}

/**
 * Define o conteúdo do pacote — **substitui a lista inteira**, não mescla.
 *
 * É o contrato do registro, e a razão está lá: "adicionar" sem poder remover produziria pacotes
 * que só crescem, e um item esquecido lá dentro é acesso que ninguém pretendeu conceder.
 *
 * Cada item aponta para um CANAL, não para uma revisão fixa — é o que torna o pacote vivo:
 * promover o canal reaponta todos os consumidores sem que ninguém reedite o pacote.
 */
export function setBundleItems<T>(
  bundleId: string,
  items: readonly { skill_id: string; channel: string }[],
): Promise<T | null> {
  return cloudFetch<T>(
    `${BUNDLES}/${encodeURIComponent(bundleId)}/items`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) },
    { throwOnError: true },
  );
}
