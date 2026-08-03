import { ApiError } from '@/lib/api';

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
        `Revisão ${v} criada com o conteúdo antigo, mas nenhum label foi movido — ` +
        `nada em produção mudou. Promova um label para ${v} se era isso que você queria.`,
    };
  }
  const movidos = resposta.labelsMoved.join(', ');
  return {
    tom: 'sucesso',
    texto: `Revisão ${v} criada e ${movidos} passou a apontar para ela.`,
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
    `Isto cria a revisão ${nova} de "${intencao.nome}" com o conteúdo de ${origem}. ` +
    `O histórico não encolhe: ${origem} continua onde está.`;
  return intencao.label === null
    ? `${base} Como você não escolheu label, nenhum label será movido e nada em produção muda.`
    : `${base} O label ${intencao.label} deixa de servir o que serve hoje e passa a apontar para ${nova}.`;
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
const GENERICA = 'Não foi possível concluir a operação. Tente novamente em instantes.';

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
    return `Não existe a versão v${corpo.toVersion} deste prompt.`;
  }
  return doServico ?? GENERICA;
}
