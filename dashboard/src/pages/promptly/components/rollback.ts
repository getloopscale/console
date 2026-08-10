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
  readonly texto: string;
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
      texto:
        `Revision ${v} created with the old content, but no label was moved — ` +
        `nothing changed in production. Promote a label to ${v} if that is what you wanted.`,
    };
  }
  const movidos = resposta.labelsMoved.join(', ');
  return {
    tom: 'sucesso',
    texto: `Revision ${v} created and ${movidos} now points at it.`,
  };
}

export interface IntencaoRollback {
  readonly nome: string;
  readonly paraVersao: number;
  readonly ultimaVersao: number;
  readonly label: string | null;
}

/** O que o diálogo promete ANTES de chamar — nomeando a revisão que será CRIADA. */
export function frasePreRollback(intencao: IntencaoRollback): string {
  const nova = `v${intencao.ultimaVersao + 1}`;
  const origem = `v${intencao.paraVersao}`;
  const base =
    `This creates revision ${nova} of "${intencao.nome}" with the content of ${origem}. ` +
    `History does not shrink: ${origem} stays where it is.`;
  return intencao.label === null
    ? `${base} Since you chose no label, no label will be moved and nothing changes in production.`
    : `${base} Label ${intencao.label} stops serving what it serves today and starts pointing at ${nova}.`;
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
  const corpo = recusa?.body as { availableLabels?: unknown } | undefined;
  if (Array.isArray(corpo?.availableLabels)) {
    return corpo.availableLabels.filter((l): l is string => typeof l === 'string');
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
export function mensagemDeRecusa(erro: unknown): string {
  if (!(erro instanceof ApiError)) return GENERICA;
  if (erro.status >= 500) return GENERICA;
  const corpo = erro.body as { message?: unknown; toVersion?: unknown; error?: unknown } | undefined;
  const doServico = typeof corpo?.message === 'string' ? corpo.message : null;
  if (corpo?.error === 'prompt_not_found' && typeof corpo.toVersion === 'number') {
    // O 404 do rollback nomeia o prompt, não a versão — e é a versão que o operador escolheu.
    return `Version v${corpo.toVersion} of this prompt does not exist.`;
  }
  return doServico ?? GENERICA;
}
