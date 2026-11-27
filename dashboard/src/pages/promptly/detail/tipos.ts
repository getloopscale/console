import type { UseMutationResult } from '@tanstack/react-query';
import type { PromptlyQuery } from '@/hooks/promptly/use-promptly';
import { labelRows } from '@/pages/promptly/components/projections';

/**
 * Os tipos que os cartões da tela de detalhe recebem por prop (B-009).
 *
 * ## Por que derivados, e não escritos à mão
 *
 * Cada um sai do que a fonte REALMENTE devolve — `ReturnType` do helper, o
 * genérico do `useQuery`. Redigitar a forma aqui criaria um segundo dono da
 * verdade: no dia em que o payload do prompt ganhasse um campo, os cartões
 * continuariam compilando contra a forma antiga, e o erro só apareceria como
 * `undefined` em runtime.
 *
 * É a mesma razão pela qual `BRAND_PRIMARY` mora num lugar só, e pela qual a
 * chave de cache vem da factory em vez de literal.
 */

/** O payload que a tela pede de `GET /v1/prompts/{name}`. */
interface PromptDoDetalhe {
  version?: number;
  content?: string;
  modelConfig?: { model?: string; temperature?: number; maxTokens?: number } | null;
  variables?: string[];
}

export type PromptQuery = PromptlyQuery<PromptDoDetalhe>;
export type RevisionsQuery = PromptlyQuery<unknown>;

/** As linhas de ambiente → revisão, como `labelRows` as projeta. */
export type Ponteiros = ReturnType<typeof labelRows>;

/** A mutação que grava as tags do prompt. */
export type MarcandoMutation = UseMutationResult<unknown, unknown, readonly string[], void>;
