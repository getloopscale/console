/**
 * M26 — projeção de versões × canais do registro de skills, FORA do React.
 *
 * Vive aqui, e não dentro da tela, porque é a regra que decide o que o operador vê antes de
 * promover um canal — a operação mais perigosa do produto. Regra testável só com browser é regra
 * que ninguém re-testa depois do primeiro dia.
 *
 * As formas abaixo foram **medidas** na definição das rotas do `theo-skills`
 * (`packages/api/src/server/handlers/publishing.ts`), não inferidas de nomes de método. Se elas
 * mudarem lá, é aqui que o teste quebra — e não numa tela que renderiza `undefined` em silêncio.
 */

/** `GET /v1/skills/:id/versions` → `{versions:[{version, revision_id}]}` */
interface VersionEntry {
  readonly version: string;
  readonly revision_id: string;
}

/** `GET /v1/skills/:id/channels` → `{channels:[{channel, revision_id, previous_revision_id}]}` */
export interface ChannelEntry {
  readonly channel: string;
  readonly revision_id: string;
  readonly previous_revision_id: string | null;
}

export interface VersionsPayload {
  readonly versions?: VersionEntry[];
}

export interface ChannelsPayload {
  readonly channels?: ChannelEntry[];
}

/** Uma linha da tabela de versões: a versão, sua revisão, e quais canais a servem hoje. */
export interface VersionRow {
  readonly version: string;
  readonly revisionId: string;
  /** Canais que apontam para esta revisão. Vazio é um estado NORMAL, não um erro. */
  readonly channels: string[];
}

/** Um canal afirmado duas vezes com revisões diferentes — o serviço se contradizendo. */
export interface ChannelAnomaly {
  readonly channel: string;
  readonly revisionIds: string[];
}

function listOf<T>(payload: { readonly versions?: T[]; readonly channels?: T[] } | null | undefined, key: 'versions' | 'channels'): T[] {
  if (!payload) return [];
  const value = (payload as Record<string, unknown>)[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Versões da skill como linhas ordenadas, cada uma com os canais que a servem.
 *
 * Duas decisões que parecem detalhe e não são:
 *
 * 1. **A versão sem canal PERMANECE na lista.** É justamente ela que o operador procura quando
 *    vai promover — filtrá-la tiraria da tela o insumo da única ação da jornada.
 * 2. **A ordenação é numérica, não alfabética.** Alfabeticamente `1.10.0 < 1.2.0`, e a versão
 *    mais nova apareceria no meio da lista. Quem lê "a primeira" promoveria a errada.
 */
export function versionRows(
  versions: VersionsPayload | null | undefined,
  channels: ChannelsPayload | null | undefined,
): VersionRow[] {
  const byRevision = new Map<string, string[]>();
  for (const c of listOf<ChannelEntry>(channels, 'channels')) {
    const current = byRevision.get(c.revision_id) ?? [];
    if (!current.includes(c.channel)) current.push(c.channel);
    byRevision.set(c.revision_id, current);
  }

  return listOf<VersionEntry>(versions, 'versions')
    .map((v) => ({
      version: v.version,
      revisionId: v.revision_id,
      channels: byRevision.get(v.revision_id) ?? [],
    }))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
}

/**
 * Canais que o serviço afirmou duas vezes, com revisões DIFERENTES.
 *
 * Um canal aponta para uma revisão. Duas afirmações incompatíveis não são um empate a resolver:
 * escolher uma em silêncio faria a tela exibir um estado que não existe, e a promoção seguinte
 * partiria de premissa falsa. A tela mostra a contradição em vez de escondê-la — é o mesmo
 * princípio que impede a interface de inventar um número que o serviço não afirma.
 *
 * Repetição IDÊNTICA não entra: ali não há contradição alguma.
 */
export function channelAnomalies(channels: ChannelsPayload | null | undefined): ChannelAnomaly[] {
  const seen = new Map<string, string[]>();
  for (const c of listOf<ChannelEntry>(channels, 'channels')) {
    const revs = seen.get(c.channel) ?? [];
    if (!revs.includes(c.revision_id)) revs.push(c.revision_id);
    seen.set(c.channel, revs);
  }
  return [...seen.entries()]
    .filter(([, revs]) => revs.length > 1)
    .map(([channel, revisionIds]) => ({ channel, revisionIds }));
}

/** A entrada vigente de um canal, ou `null`. Nunca um objeto vazio plausível. */
export function currentChannelOf(
  channels: ChannelsPayload | null | undefined,
  channel: string,
): ChannelEntry | null {
  return listOf<ChannelEntry>(channels, 'channels').find((c) => c.channel === channel) ?? null;
}
