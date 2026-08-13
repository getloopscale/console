import type { AuthMethod } from '@/lib/telemetry/rum';

/**
 * B-096 — a tentativa de login que atravessa a navegação.
 *
 * O login usa `form.submit()` porque o Kratos exige um POST de nível de browser
 * para seguir o redirect OIDC. A página navega, e com ela morre o `useRef` que
 * guardava o `correlation_id` da tentativa. Por isso `auth.method.success` e
 * `auth.method.failure` estavam declarados desde 2026-05-29 e nunca foram
 * emitidos: o desfecho acontece numa página que não sabe o que foi tentado.
 *
 * Este módulo é o elo. Ele carrega a tentativa pelo `sessionStorage` e a entrega
 * exatamente uma vez do outro lado da navegação.
 *
 * ## Por que sessionStorage e não localStorage
 *
 * A tentativa tem de morrer com a aba. Uma tentativa de ontem sobrevivendo ao
 * fechamento do navegador emitiria, no próximo login, um sucesso correlacionado
 * à tentativa errada — pior que não medir, porque parece medida.
 *
 * ## Por que a leitura consome
 *
 * O desfecho é emitido no primeiro render autenticado, e todo render autenticado
 * passa pelo mesmo ponto. Sem consumo, um F5 no dashboard emitiria mais um
 * sucesso para a mesma tentativa, e a métrica passaria a contar recarregamentos.
 *
 * ## Por que falha em silêncio
 *
 * `rules/error-handling.md` proíbe engolir exceção, e com razão. Aqui há uma
 * exceção declarada: o Safari em modo privado e políticas corporativas fazem o
 * acesso ao storage LANÇAR. Telemetria nunca pode impedir alguém de entrar no
 * produto — o custo de falhar alto é perder o login; o de falhar em silêncio é
 * perder um evento. Está dito em voz alta aqui porque um `catch` mudo sem esta
 * justificativa seria, corretamente, um defeito.
 */

/** Chave do `sessionStorage`. Exportada para o teste inspecionar o descarte. */
export const PENDING_ATTEMPT_KEY = 'theo.auth.pending-attempt';

export interface PendingAttempt {
  method: AuthMethod;
  correlation_id: string;
  started_at: number;
}

/** Registra a tentativa em curso. Nunca lança — ver o bloco acima. */
export function recordAttempt(attempt: PendingAttempt): void {
  try {
    sessionStorage.setItem(PENDING_ATTEMPT_KEY, JSON.stringify(attempt));
  } catch {
    // Storage bloqueado. O login segue sem telemetria de desfecho.
  }
}

/**
 * Devolve a tentativa pendente e a remove. `null` quando não há nenhuma, quando
 * o storage está bloqueado, ou quando o que estava lá não é uma tentativa
 * válida — um desfecho sem `correlation_id` não liga em nada e seria ruído com
 * aparência de dado.
 */
export function takePendingAttempt(): PendingAttempt | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(PENDING_ATTEMPT_KEY);
    if (raw !== null) sessionStorage.removeItem(PENDING_ATTEMPT_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const v = JSON.parse(raw) as Partial<PendingAttempt>;
    if (typeof v?.correlation_id !== 'string' || !v.correlation_id) return null;
    if (typeof v.method !== 'string') return null;
    return {
      method: v.method as AuthMethod,
      correlation_id: v.correlation_id,
      // Um `started_at` ausente vira 0, o que produziria uma latência absurda.
      // Melhor a data de agora: a latência sai zero, que é honestamente
      // "não sei", em vez de "56 anos".
      started_at: typeof v.started_at === 'number' ? v.started_at : Date.now(),
    };
  } catch {
    return null;
  }
}
