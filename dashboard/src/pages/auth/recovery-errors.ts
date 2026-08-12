import { FlowSubmitError } from '@/pages/auth/kratos';

/** O que a tela de recuperação diz quando o SERVIÇO recusou, e não o formulário. */
export const SERVICE_UNAVAILABLE_MESSAGE =
  'Recovery service temporarily unavailable. Try again in a minute, or contact support@usetheo.dev.';

/**
 * O que dizer quando a submissão de um fluxo de recuperação falhou (B-233).
 *
 * ## O defeito
 *
 * Dois handlers tinham, byte a byte, a mesma escada:
 *
 * ```
 * if (is5xxOrNetwork(err)) { setErrorMessage(SERVICE_UNAVAILABLE); }
 * else                     { setErrorMessage(SERVICE_UNAVAILABLE); }
 * ```
 *
 * A classificação era CALCULADA e jogada fora. Um `if` cujos dois ramos fazem a mesma coisa não é
 * código morto inofensivo: ele afirma que alguém pensou na distinção e a tratou, e nenhum teste
 * pode notar que não. Apagar o `if` teria removido o sintoma e a pergunta junto — a pergunta certa
 * é o que o segundo ramo DEVERIA dizer.
 *
 * ## A resposta
 *
 * As duas causas pedem ações opostas de quem está lendo. Um 5xx ou uma queda de rede dizem
 * "tente de novo daqui a pouco" — a pessoa não pode fazer nada além disso. Um erro que NÃO é
 * disso (um fluxo expirado, um CSRF recusado, uma resposta que não deu para interpretar) diz
 * "recomece" — e insistir em tentar de novo com o mesmo fluxo não vai funcionar nunca.
 *
 * Dizer "tente de novo" para o segundo caso é mandar a pessoa repetir algo que está garantido
 * a falhar.
 *
 * `seNaoForServico` existe porque UM dos três chamadores já tinha a frase certa para o lado
 * não-serviço — o de código, cujo erro é "código inválido ou expirado", não "link inválido".
 * Aquele `if` era o único dos três cujos ramos diferiam de verdade, e uniformizar os três teria
 * apagado a única distinção que já estava correta.
 */
export function recoveryErrorMessage(err: unknown, seNaoForServico?: string): string {
  if (ehFalhaDeServico(err)) return SERVICE_UNAVAILABLE_MESSAGE;
  return seNaoForServico ?? FLUXO_INVALIDO;
}

/** O texto padrão do lado não-serviço, quando o chamador não tem um mais específico. */
const FLUXO_INVALIDO =
  'This recovery link is no longer valid. Start again from the login screen and request a new one.';

/**
 * A causa é o serviço estar fora, e não este fluxo estar velho?
 *
 * `FlowSubmitError` (B-232) traz o status observado, então 5xx é uma leitura direta em vez de uma
 * busca por três dígitos numa mensagem. A varredura textual fica como rede para erros que não
 * passam por `submitFlow`, e a rejeição de rede do `fetch` chega como `TypeError`.
 */
function ehFalhaDeServico(err: unknown): boolean {
  if (err instanceof FlowSubmitError) return err.status >= 500;
  if (err instanceof TypeError) return true; // rejeição de rede
  const msg = err instanceof Error ? err.message : String(err);
  return /\b5\d\d\b/.test(msg);
}
