/**
 * As formas de payload da API de trust.
 *
 * B-052 — moradas antes em `pages/trust/components/trust-series.ts`, junto da
 * lógica de apresentação. O guard de camada apanhou a consequência quando o hook
 * precisou delas: `hooks/` não pode importar de `pages/`, porque uma página que
 * exporta domínio para o que está abaixo dela fecha um ciclo.
 *
 * Aqui é o lugar certo por coesão, não só por camada: **quem busca declara a
 * forma do que busca**. `trust-api.ts` é o módulo que fala com o endpoint, então
 * é ele que sabe o que o endpoint devolve.
 */

/** Uma violação de política devolvida por `GET /v1/policy-violations`. */
export interface PolicyViolation {
  readonly id?: string;
  readonly messageId?: string;
  readonly conversationId?: string;
  readonly policy?: string;
  readonly severity?: string;
  readonly detectedAt?: string;
  /**
   * O trecho já redigido pelo serviço (`"sk…ab"`) — nunca o conteúdo bruto.
   *
   * É o único campo que descreve O QUE foi detectado, e o serviço o manda hoje. `detectedAt` e
   * `conversationId` estão declarados porque o contrato os prevê, mas medido em 2026-08-01 o
   * `/policy-violations` do deploy NÃO os devolve — ver a issue de contrato.
   */
  readonly redacted?: string;
  readonly [k: string]: unknown;
}

export interface ViolationsPayload {
  readonly violations?: readonly PolicyViolation[];
  readonly [k: string]: unknown;
}

/** Um validator do catálogo mesclado plataforma+tenant. */
export interface Validator {
  readonly name?: string;
  readonly category?: string;
  readonly policy?: string;
  readonly [k: string]: unknown;
}

export interface ValidatorsPayload {
  readonly validators?: readonly Validator[];
  readonly items?: readonly Validator[];
  readonly [k: string]: unknown;
}

export interface ConversationMessage {
  readonly id?: string;
  readonly role?: string;
  readonly content?: string;
  readonly createdAt?: string;
  readonly [k: string]: unknown;
}

export interface ConversationPayload {
  readonly id?: string;
  readonly messages?: readonly ConversationMessage[];
  readonly [k: string]: unknown;
}

export interface EnforcementPayload {
  readonly events?: readonly EnforcementEvent[];
}

export interface CatalogPayload {
  readonly catalogVersion?: number;
  readonly validators?: readonly CatalogEntry[];
}

export interface EnforcementEvent {
  readonly id?: string;
  readonly decision?: string;
  readonly direction?: string;
  readonly category?: string;
  readonly validatorName?: string;
  readonly redacted?: string;
  readonly createdAt?: string;
}

/** Uma linha do catálogo como o serviço a devolve. Campos extras são ignorados de propósito. */
export interface CatalogEntry {
  readonly source?: string;
  readonly id?: string;
  readonly name?: string;
  /** Presente nas regras de PLATAFORMA. Nas do tenant o equivalente é `spec.kind`. */
  readonly kind?: string;
  /** O que a regra de plataforma detecta (`credential_leak`, `pii_exposure`, …). */
  readonly category?: string | null;
  /** Presente nas regras do TENANT. */
  readonly spec?: CatalogSpec;
  readonly directions?: readonly string[];
}

/** A spec de uma regra do tenant. É aqui que vive o `kind` dela — não no topo da entrada. */
export interface CatalogSpec {
  readonly kind?: string;
  readonly terms?: readonly string[];
  readonly action?: string;
}
