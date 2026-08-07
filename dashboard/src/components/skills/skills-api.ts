import { ApiError, cloudFetch } from '@/lib/http/api';
import {
  corpoDoDiagnostico,
  type EstadoDaCandidata,
} from '@/components/skills/discoverability-request';
import { corpoDaPublicacao } from '@/components/skills/skill-upload';

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

/**
 * O acervo do inquilino. `limit` explícito: sem ele herdaríamos o teto do servidor sem saber qual é.
 *
 * `pageToken` (M31) percorre o acervo além da primeira página. Até este milestone o
 * `next_page_token` era **tipado e não usado** — acima do teto o excedente sumia sem erro algum,
 * e a tela dizia "12 no acervo" com 300 lá dentro.
 */
export function fetchSkills<T>(limit: number, pageToken?: string): Promise<T | null> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (pageToken !== undefined && pageToken !== '') params.set('page_token', pageToken);
  return cloudFetch<T>(`${BASE}?${params.toString()}`, {}, { throwOnError: true });
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
  if (err.status === 403) return 'Your credential is not allowed to promote channels in this workspace.';
  return err.status === 0 ? 'Could not reach the server.' : fallback;
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

/**
 * Muda o estágio de ciclo de vida de uma skill — `active` · `draft` · `deprecated`.
 *
 * **Depreciar não tira a skill de quem já a referencia**: ela continua resolvível, e o que muda é
 * a descoberta. É por isso que este ato é menos perigoso que promover um canal — que troca o que
 * os consumidores carregam, sem redeploy.
 *
 * `reason` é obrigatório ao depreciar (o BFF recusa sem ele) e ignorado nos outros estágios: ir
 * para `active` não tira nada de ninguém. `superseded_by` é sempre opcional.
 */
export function setSkillLifecycle<T>(
  skillId: string,
  lifecycle: 'active' | 'draft' | 'deprecated',
  reason: string,
  supersededBy: string,
): Promise<T | null> {
  return cloudFetch<T>(
    `${BASE}/${encodeURIComponent(skillId)}/lifecycle`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lifecycle,
        ...(reason !== '' ? { reason } : {}),
        ...(supersededBy !== '' ? { superseded_by: supersededBy } : {}),
      }),
    },
    { throwOnError: true },
  );
}

/**
 * A descoberta — a razão de existir do produto, e a última jornada sem tela.
 *
 * A resposta traz `score` **e** `matched`. As duas juntas é que tornam a busca observável: sem a
 * segunda, a tela mostra um número sem dizer de onde veio.
 *
 * Os filtros de ciclo de vida existem porque a descoberta esconde rascunhos e descontinuadas por
 * padrão (M32) — sem poder ligá-los, ninguém consegue verificar na tela que uma deprecada de fato
 * saiu, que é o comportamento prometido por aquele milestone.
 */
export function retrieveSkills<T>(
  query: string,
  topK: number,
  includeDraft: boolean,
  includeDeprecated: boolean,
): Promise<T | null> {
  const params = new URLSearchParams({ query, top_k: String(topK) });
  if (includeDraft) params.set('include_draft', 'true');
  if (includeDeprecated) params.set('include_deprecated', 'true');
  return cloudFetch<T>(`${BASE}/:retrieve?${params.toString()}`, {}, { throwOnError: true });
}

/**
 * Apaga uma skill — a operação IRREVERSÍVEL desta capacidade.
 *
 * O registro faz soft-delete e **reserva o identificador**: quem já referencia a skill pelo id não
 * consegue recriá-la com o mesmo nome. É por isso que descontinuar existe (M32) — é o ato
 * reversível para "não use mais esta", e a tela precisa oferecer os dois com a diferença clara.
 *
 * Responde `204 sem corpo`.
 */
export function deleteSkill(skillId: string): Promise<null> {
  return cloudFetch<null>(
    `${BASE}/${encodeURIComponent(skillId)}`,
    { method: 'DELETE' },
    { throwOnError: true },
  );
}

// ---- M31 — AUTORIA ---------------------------------------------------------------------------

/**
 * Valida um SKILL.md **sem publicar**.
 *
 * O M30 entregou `POST /v1/skills:validate` e ela ficou **sem consumidor**: o erro traz `field` e
 * `line`, e nada disso alcançava um autor porque não havia tela de autoria. É o que permite
 * escrever sem publicar às cegas.
 */
export function validateSkill<T>(skillMd: string): Promise<T | null> {
  return cloudFetch<T>(
    `${BASE}/:validate`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skill_md: skillMd }) },
    { throwOnError: true },
  );
}

/**
 * Publica uma skill. Responde **202 — aceito, não pronto**.
 *
 * A ingestão gera embeddings, e amarrar a tela ao tempo de um provedor externo numa requisição
 * HTTP faria o autor esperar sem saber por quê. Quem chama precisa acompanhar a operação.
 */
export function createSkill<T>(skillId: string, skillMd: string): Promise<T | null> {
  return publishSkill<T>(corpoDaPublicacao(skillId, { tipo: 'markdown', conteudo: skillMd }));
}

/**
 * Publica uma skill que é uma ÁRVORE de arquivos — scripts Python/Bash, `assets/`, `reference/`.
 *
 * O registro sempre aceitou isso (`zippedFilesystem`, um zip em base64) e a CLI publica assim desde
 * o M12. Só a tela não tinha o caminho, então quem escrevia uma skill com script precisava de
 * terminal para publicá-la.
 *
 * Função SEPARADA de `createSkill`, e não um parâmetro opcional, porque as duas formas são
 * excludentes: o BFF recusa markdown e zip no mesmo corpo, já que o registro priorizaria o markdown
 * e descartaria os scripts em silêncio.
 */
export function createSkillFromZip<T>(skillId: string, zipBase64: string): Promise<T | null> {
  return publishSkill<T>(corpoDaPublicacao(skillId, { tipo: 'zip', base64: zipBase64 }));
}

function publishSkill<T>(corpo: Record<string, string>): Promise<T | null> {
  return cloudFetch<T>(
    BASE,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) },
    { throwOnError: true },
  );
}

/** O estado de uma operação de ingestão — o que permite ACOMPANHAR em vez de fingir que terminou. */
export function fetchOperation<T>(operationId: string): Promise<T | null> {
  return cloudFetch<T>(`/v1/dashboard/operations/${encodeURIComponent(operationId)}`, {}, { throwOnError: true });
}

/**
 * O diagnóstico posicionado que `:validate` devolve — `field` e `line` quando existem.
 *
 * Sem isto o autor lê "inválido" e procura o problema no texto inteiro. Com isto, ele vai à linha.
 */
export function validationDiagnostic(err: unknown): { message: string; field?: string; line?: number } {
  if (!(err instanceof ApiError)) return { message: 'Could not validate.' };
  const body = err.body as { message?: unknown; error?: unknown; field?: unknown; line?: unknown } | undefined;
  const message =
    typeof body?.message === 'string' && body.message !== ''
      ? body.message
      : typeof body?.error === 'string'
        ? body.error
        : 'Invalid content.';
  return {
    message,
    ...(typeof body?.field === 'string' ? { field: body.field } : {}),
    ...(typeof body?.line === 'number' ? { line: body.line } : {}),
  };
}

/**
 * M34 — diagnostica se a skill seria **achada**, sem publicá-la e sem executá-la.
 *
 * Distinto de `validateSkill`: aquela responde "é válida?"; esta, "é achável?". A segunda compara
 * a candidata com o acervo real, e é a que responde a promessa do produto — uma skill válida e
 * inachável é, para quem procura, indistinguível de uma que não existe.
 */
export function diagnoseDiscoverability<T>(
  name: string,
  description: string,
  estado: EstadoDaCandidata,
): Promise<T | null> {
  return cloudFetch<T>(
    `${BASE}/:discoverability`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // O corpo é montado por uma função PURA e testada: o defeito da theo-skills#144 era
      // exatamente ele — `has_embedding: false` fixo para um rascunho — e, montado inline aqui,
      // nenhum teste o alcançava.
      body: JSON.stringify(corpoDoDiagnostico(name, description, estado)),
    },
    { throwOnError: true },
  );
}
