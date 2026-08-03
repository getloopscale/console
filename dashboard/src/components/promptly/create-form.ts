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

export interface ValidacaoCriacao {
  readonly ok: boolean;
  readonly erroNome: string | null;
}

export function validarCriacao(nome: string): ValidacaoCriacao {
  const limpo = nome.trim();
  if (limpo === '') {
    return { ok: false, erroNome: 'Dê um nome ao prompt.' };
  }
  if (!NOME_SEGURO.test(limpo)) {
    return {
      ok: false,
      erroNome:
        'Use apenas letras, números, ponto, hífen e sublinhado. ' +
        'Barras e espaços quebram o endereço que lê o prompt de volta.',
    };
  }
  return { ok: true, erroNome: null };
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
