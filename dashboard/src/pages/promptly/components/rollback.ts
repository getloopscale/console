import { ApiError } from '@/lib/http/api';

/**
 * M12 T6/T7 — a lógica de reverter, FORA do React.
 *
 * Reverter é a ação mais perigosa desta jornada, e a que mais facilmente MENTE. Duas coisas
 * medidas contra a API real governam tudo aqui:
 *
 *  - reverter **cria uma revisão nova**; não apaga histórico. Um texto de "volta para a v1" faz
 *    o operador esperar o histórico encolher, e ele nunca encolhe;
 *  - um prompt **sem nenhum label** devolve `201` com `labelsMoved: []` — a revisão é criada e
 *    **nada em produção muda**. Ler "revertido" do status seria recriar o defeito LT-030, que o
 *    produto já corrigiu no corpo da resposta, uma camada acima.
 */

export interface LabelPointer {
  readonly label: string;
  readonly version: number;
}

export interface RespostaRollback {
  readonly version: number;
  readonly labelsMoved: readonly string[];
  readonly currentLabels: readonly LabelPointer[];
}

export interface ResultadoRollback {
  readonly tom: 'sucesso' | 'atencao';
  readonly text: string;
}

/**
 * O que a tela afirma DEPOIS da chamada — derivado de `labelsMoved`, nunca do status.
 *
 * `labelsMoved: []` com `201` é o caso que separa uma tela honesta de uma que dá falsa
 * segurança durante um incidente.
 */
export function resultadoDoRollback(resposta: RespostaRollback): ResultadoRollback {
  const v = `v${resposta.version}`;
  if (resposta.labelsMoved.length === 0) {
    return {
      tom: 'atencao',
      text:
        `Revision ${v} created with the old content, but no label was moved — ` +
        `nothing changed in production. Promote a label to ${v} if that is what you wanted.`,
    };
  }
  const movidos = resposta.labelsMoved.join(', ');
  return {
    tom: 'sucesso',
    text: `Revision ${v} created and ${movidos} now points at it.`,
  };
}

export interface IntencaoRollback {
  readonly name: string;
  readonly toVersion: number;
  readonly ultimaVersao: number;
  readonly label: string | null;
}

/** O que o diálogo promete ANTES de chamar — nomeando a revisão que será CRIADA. */
export function frasePreRollback(intencao: IntencaoRollback): string {
  const newRevision = `v${intencao.ultimaVersao + 1}`;
  const origin = `v${intencao.toVersion}`;
  const base =
    `This creates revision ${newRevision} of "${intencao.name}" with the content of ${origin}. ` +
    `History does not shrink: ${origin} stays where it is.`;
  return intencao.label === null
    ? `${base} Since you chose no label, no label will be moved and nothing changes in production.`
    : `${base} Label ${intencao.label} stops serving what it serves today and starts pointing at ${newRevision}.`;
}

/**
 * Os labels que a tela OFERECE — sempre vindos da API, nunca digitados.
 *
 * Medido: um label inexistente devolve `404 prompt_not_found`, com o nome de um prompt que
 * existe. O operador erra uma letra durante um incidente e é informado de que o prompt sumiu.
 * Oferecer apenas o que a API devolveu torna esse 404 inalcançável pela UI — constranger a
 * entrada elimina o caso, onde corrigir a mensagem só o disfarçaria.
 */
export function labelsOferecidos(
  recusa: ApiError | null,
  labelsAtuais: readonly LabelPointer[] = [],
): string[] {
  const body = recusa?.body as { availableLabels?: unknown } | undefined;
  if (Array.isArray(body?.availableLabels)) {
    return body.availableLabels.filter((l): l is string => typeof l === 'string');
  }
  return labelsAtuais.map((l) => l.label);
}

/** Texto genérico para falha de infraestrutura — detalhe interno não vai para a tela do cliente. */
const GENERICA = 'Could not complete the operation. Try again in a moment.';

/**
 * A recusa do serviço, legível — mas só quando ela é DO SERVIÇO.
 *
 * `4xx` é decisão de negócio e o corpo explica a razão: repassar é o que evita "erro ao salvar"
 * sobre uma regra que o operador consegue atender. `5xx` é falha de infraestrutura e o corpo
 * pode carregar host, porta e stack — vira mensagem genérica. Sem esse contraste, o repasse
 * seria um matcher cego.
 */
export function rejectionMessage(failure: unknown): string {
  if (!(failure instanceof ApiError)) return GENERICA;
  if (failure.status >= 500) return GENERICA;
  const body = failure.body as { message?: unknown; toVersion?: unknown; error?: unknown } | undefined;
  const fromService = typeof body?.message === 'string' ? body.message : null;
  if (body?.error === 'prompt_not_found' && typeof body.toVersion === 'number') {
    // O 404 do rollback nomeia o prompt, não a versão — e é a versão que o operador escolheu.
    return `Version v${body.toVersion} of this prompt does not exist.`;
  }
  return fromService ?? GENERICA;
}
