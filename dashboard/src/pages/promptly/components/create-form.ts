/**
 * M12 T3 — a validação do formulário de autoria, FORA do React.
 *
 * O nome é o único campo que a tela restringe MAIS do que a API, e a diferença é deliberada:
 * `POST /prompts` aceita `time/saudacao` e devolve 201 (medido), mas a leitura só responde com
 * `%2F` na URL — e entre o navegador e o produto há dois intermediários (o mux Go do BFF e o
 * Traefik) cujo tratamento de barra codificada **não foi medido**. Criar um nome que talvez não
 * possa ser lido de volta é o tipo de dado que fica no histórico para sempre, porque não há
 * `DELETE`. Restringir na origem custa uma mensagem; não restringir custa uma revisão órfã.
 */

/** Caracteres seguros num segmento de URL, sem depender de codificação de ninguém. */
const NOME_SEGURO = /^[A-Za-z0-9._-]+$/;

/**
 * M17 — o teto da descrição, espelhado do domínio (`CHANGE_DESCRIPTION_MAX`).
 *
 * Duplicado de propósito em vez de importado: o dashboard é outro artefato, e arrastar
 * o pacote do servidor por uma constante seria acoplamento maior que a duplicação. O
 * número aparece na mensagem, então uma divergência apareceria na tela — e há teste
 * de fronteira no servidor que recusa acima do teto de qualquer forma.
 */
export const DESCRICAO_MAX = 500;

export interface ValidacaoCriacao {
  readonly ok: boolean;
  readonly erroNome: string | null;
  readonly erroDescricao: string | null;
}

export interface EntradaCriacao {
  readonly nome: string;
  readonly descricao: string;
}

/**
 * M17 — a assinatura passou a receber o FORMULÁRIO, não só o nome.
 *
 * Os dois erros são reportados juntos. Reportar um de cada vez faria o operador
 * corrigir, submeter, e só então descobrir o segundo — duas viagens para um
 * formulário de dois campos.
 *
 * A descrição é obrigatória AQUI e opcional na API (ADR-3): a obrigação é sobre quem
 * DECIDE, e quem decide está nesta tela. Um script que cria revisões não pode passar
 * a precisar de texto.
 */
export function validarCriacao(entrada: EntradaCriacao): ValidacaoCriacao {
  const nome = entrada.nome.trim();
  const descricao = entrada.descricao.trim();

  let erroNome: string | null = null;
  if (nome === '') {
    erroNome = 'Dê um nome ao prompt.';
  } else if (!NOME_SEGURO.test(nome)) {
    erroNome =
      'Use apenas letras, números, ponto, hífen e sublinhado. ' +
      'Barras e espaços quebram o endereço que lê o prompt de volta.';
  }

  let erroDescricao: string | null = null;
  if (descricao === '') {
    erroDescricao =
      'Diga por que esta revisão existe. Numa reversão às três da manhã, é isto que ' +
      'decide qual versão voltar.';
  } else if (entrada.descricao.length > DESCRICAO_MAX) {
    erroDescricao = `A descrição passa de ${String(DESCRICAO_MAX)} caracteres.`;
  }

  return { ok: erroNome === null && erroDescricao === null, erroNome, erroDescricao };
}

/**
 * O que o formulário afirma sobre o que está prestes a acontecer.
 *
 * Diz a permanência porque ela é real e não tem desfazer: revisões são imutáveis e o produto não
 * expõe `DELETE`. Um operador que descobre isso DEPOIS de salvar já não pode agir.
 */
export function fraseDePermanencia(nomeExistente: boolean, proximaVersao: number): string {
  const base = `Isto cria a revisão v${proximaVersao}`;
  const contexto = nomeExistente
    ? ' deste prompt, ao lado das que já existem.'
    : ' de um prompt novo.';
  return (
    `${base}${contexto} Revisões são imutáveis: não há como editar nem apagar depois. ` +
    'Para corrigir, cria-se outra revisão.'
  );
}
