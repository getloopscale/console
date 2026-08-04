/**
 * M34 — o corpo da consulta ao diagnóstico de descobribilidade.
 *
 * Existe fora do cliente HTTP porque o defeito da theo-skills#144 **era o corpo**, e enquanto ele
 * era montado inline dentro da função de fetch nenhum teste o alcançava.
 */

/**
 * O estado da candidata. União discriminada, e não `hasEmbedding?: boolean`, porque **"não
 * publicada e com vetor" não existe** — vetor é propriedade de uma revisão, e um rascunho não tem
 * revisão. Espelha `EstadoDaRevisao` do domínio (`theo-skills`
 * `packages/core/src/domain/discoverability.ts`).
 */
export type EstadoDaCandidata =
  | { readonly publicada: false }
  | { readonly publicada: true; readonly temVetor: boolean };

export interface CorpoDiagnostico {
  readonly name: string;
  readonly description: string;
  /** AUSENTE para rascunho. A presença é o que distingue "não há revisão" de "revisão sem vetor". */
  readonly has_embedding?: boolean;
}

/**
 * Monta o corpo, preservando a distinção que o contrato carrega na PRESENÇA do campo:
 *
 * | `has_embedding` | significa | `no_embedding` é achado? |
 * |---|---|---|
 * | ausente | rascunho, sem revisão | não — ele não tem revisão para ter vetor |
 * | `false` | publicada, sem vetor | sim — a ingestão falhou ou não rodou |
 * | `true` | publicada, com vetor | não |
 *
 * A tela enviava `false` fixo para rascunhos. Como `no_embedding` disparava sempre, ela dominava
 * o veredito e encobria as causas que o autor poderia corrigir antes de publicar — que é a única
 * coisa que ele quer saber naquele momento.
 */
export function corpoDoDiagnostico(
  name: string,
  description: string,
  estado: EstadoDaCandidata,
): CorpoDiagnostico {
  if (!estado.publicada) return { name, description };
  return { name, description, has_embedding: estado.temVetor };
}
