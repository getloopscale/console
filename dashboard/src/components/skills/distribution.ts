/**
 * M35 — projeções da tela de distribuição: tokens delegados e adoção.
 *
 * Vive FORA do React porque é onde as decisões que fazem a tela mentir de fato moram: qual estado
 * um token tem, sobre qual denominador a proporção é calculada, e quando a resposta honesta é
 * "não sei" em vez de um número. Testar isso por render seria testar o React.
 */

// ---- Tokens ---------------------------------------------------------------------------------

export interface TokenEntry {
  readonly token_id: string;
  readonly label: string | null;
  readonly quota_per_window: number | null;
  readonly expires_at: string;
  readonly revoked_at: string | null;
  readonly create_time: string;
}

export interface TokensPayload {
  readonly bundle_id?: string;
  readonly tokens?: readonly TokenEntry[];
}

/**
 * `unknown` existe porque uma data ilegível não pode virar um estado afirmativo.
 *
 * Sem ele o código escolheria entre chamar de ativo (exibindo como utilizável algo que não sabe
 * ler) ou de expirado (cortando na tela um token que o serviço ainda aceita). Ambas afirmam mais
 * do que o dado sustenta.
 */
export type TokenStatus = 'active' | 'expired' | 'revoked' | 'unknown';

export interface TokenRow {
  readonly tokenId: string;
  readonly labelText: string;
  readonly status: TokenStatus;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly quotaPerWindow: number | null;
}

function statusDoToken(entry: TokenEntry, agora: Date): TokenStatus {
  // A revogação vem PRIMEIRO, e a ordem é a regra: um token revogado nunca volta a valer, e
  // exibi-lo como expirado esconderia que alguém o cortou de propósito — o operador precisa saber
  // qual dos dois aconteceu.
  if (entry.revoked_at !== null && entry.revoked_at !== undefined) return 'revoked';

  const expira = Date.parse(entry.expires_at);
  if (Number.isNaN(expira)) return 'unknown';

  // `<=`: no instante exato da expiração o serviço já recusa. Tratar como ativo faria a tela
  // discordar do backend sobre o mesmo token.
  return expira <= agora.getTime() ? 'expired' : 'active';
}

export function tokenRows(payload: TokensPayload | null | undefined, agora: Date): TokenRow[] {
  const entries = payload?.tokens;
  if (!Array.isArray(entries)) return [];

  return entries.map((entry) => ({
    tokenId: entry.token_id,
    // "sem rótulo" e não string vazia: uma célula em branco parece dado faltando na tela, e o
    // operador vai procurar o defeito que não existe.
    labelText: entry.label !== null && entry.label !== undefined && entry.label !== '' ? entry.label : 'sem rótulo',
    status: statusDoToken(entry, agora),
    expiresAt: entry.expires_at,
    revokedAt: entry.revoked_at ?? null,
    quotaPerWindow: entry.quota_per_window ?? null,
  }));
}

// ---- Adoção ---------------------------------------------------------------------------------

export interface AdoptionEntry {
  readonly skill_id: string;
  readonly version: string;
  readonly installs: number;
}

export interface AdoptionPayload {
  /** O denominador da JANELA — não a soma das linhas devolvidas. Ver `adoptionRows`. */
  readonly total_installs?: number;
  readonly adoption?: readonly AdoptionEntry[];
}

export interface AdoptionRow {
  readonly skillId: string;
  readonly version: string;
  readonly installs: number;
  /** `null` quando não há denominador — que é diferente de 0%. */
  readonly share: number | null;
}

/**
 * Projeta a adoção, ordenada da maior para a menor.
 *
 * **A proporção usa `total_installs`, nunca a soma das linhas.** Sob paginação ou top-N a soma é
 * de um recorte, e usá-la como denominador infla toda proporção — o gráfico erra em silêncio, que
 * é o pior modo de errar num gráfico.
 *
 * **Sem denominador, `share` é `null` e não `0`.** As duas coisas dizem frases opostas ao
 * operador: `0%` afirma "ninguém instalou esta skill"; `null` admite "não dá para calcular
 * proporção". Com zero instalações na janela, só a segunda é verdadeira.
 *
 * A granularidade das linhas é **skill + versão**, escopada ao bundle. NÃO é "por bundle" — o que
 * não existe é agregação ENTRE bundles: uma skill publicada em três bundles produz três linhas, e
 * "instalações totais da skill X" não é computável. Quem rotular a tela precisa dizer isso.
 */
export function adoptionRows(payload: AdoptionPayload | null | undefined): AdoptionRow[] {
  const entries = payload?.adoption;
  if (!Array.isArray(entries)) return [];

  const total = payload?.total_installs;
  const temDenominador = typeof total === 'number' && total > 0;

  return entries
    .map((entry) => ({
      skillId: entry.skill_id,
      version: entry.version,
      installs: entry.installs,
      share: temDenominador ? entry.installs / total : null,
    }))
    .sort((a, b) =>
      // Desempate por identificador: sem ele a ordem dança entre renders com contagens iguais, e
      // a tabela parece instável sem nada ter mudado.
      b.installs !== a.installs ? b.installs - a.installs : a.skillId.localeCompare(b.skillId),
    );
}
