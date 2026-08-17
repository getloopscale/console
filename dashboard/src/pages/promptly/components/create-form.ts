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
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * M17 — o teto da descrição, espelhado do domínio (`CHANGE_DESCRIPTION_MAX`).
 *
 * Duplicado de propósito em vez de importado: o dashboard é outro artefato, e arrastar
 * o pacote do servidor por uma constante seria acoplamento maior que a duplicação. O
 * número aparece na mensagem, então uma divergência apareceria na tela — e há teste
 * de fronteira no servidor que recusa acima do teto de qualquer forma.
 */
export const DESCRIPTION_MAX = 500;

export interface ValidacaoCriacao {
  readonly ok: boolean;
  readonly nameError: string | null;
  readonly descriptionError: string | null;
}

export interface EntradaCriacao {
  readonly name: string;
  readonly description: string;
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
  const name = entrada.name.trim();
  const description = entrada.description.trim();

  let nameError: string | null = null;
  if (name === '') {
    nameError = 'Give the prompt a name.';
  } else if (!SAFE_NAME.test(name)) {
    nameError =
      'Use only letters, digits, dot, hyphen and underscore. ' +
      'Slashes and spaces break the address that reads the prompt back.';
  }

  let descriptionError: string | null = null;
  if (description === '') {
    descriptionError =
      'Say why this revision exists. In a rollback at three in the morning, this is what ' +
      'decides which version to go back to.';
  } else if (entrada.description.length > DESCRIPTION_MAX) {
    descriptionError = `The description exceeds ${String(DESCRIPTION_MAX)} characters.`;
  }

  return { ok: nameError === null && descriptionError === null, nameError, descriptionError };
}

/**
 * O que o formulário afirma sobre o que está prestes a acontecer.
 *
 * Diz a permanência porque ela é real e não tem desfazer: revisões são imutáveis e o produto não
 * expõe `DELETE`. Um operador que descobre isso DEPOIS de salvar já não pode agir.
 */
export function fraseDePermanencia(existingName: boolean, nextVersion: number): string {
  const base = `This creates revision v${nextVersion}`;
  const contexto = existingName
    ? ' of this prompt, alongside the ones that already exist.'
    : ' of a new prompt.';
  return (
    `${base}${contexto} Revisions are immutable: there is no editing or deleting afterwards. ` +
    'To correct one, you create another revision.'
  );
}
