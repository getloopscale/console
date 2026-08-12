// T0.1 Error Reporter — receives errors from RouteBoundary / SheetBoundary
// and dispatches to /v1/telemetry endpoint. Rate-limited to prevent error
// storms that would flood the telemetry endpoint (EC-13 risk acknowledged).
//
// Invariant: this function MUST NEVER throw. A throw here would cascade
// the boundary into infinite loop (boundary catches, calls onError, which
// throws, which triggers boundary again).

interface ErrorInfo {
  componentStack?: string | null;
  routePath?: string;
}

const MAX_ERRORS_PER_SESSION = 10;
let errorsThisSession = 0;

export function resetErrorReporter(): void {
  errorsThisSession = 0;
}

/**
 * Reporta um erro capturado por um boundary. NUNCA lança (B-215).
 *
 * ## Por que o invariante é absoluto
 *
 * O boundary chama isto de dentro do próprio `onError`. Uma exceção aqui volta para o boundary,
 * que captura de novo e chama isto de novo — laço infinito com a tela de erro piscando.
 *
 * ## O que mudou
 *
 * Havia TRÊS camadas de engolimento aninhadas (CCN 16): um `try` externo, um interno em volta do
 * transporte e um `.catch(() => {})` na promise. Cumpriam o invariante e cobravam caro por ele —
 * um `catch` vazio no topo apagava também os erros de PROGRAMAÇÃO do próprio reporter, e nada
 * distinguia "o beacon falhou" de "o payload tem um bug". Um reporter de erros que engole os
 * próprios erros é o único componente do sistema que ninguém consegue depurar.
 *
 * Agora é uma camada só, e em desenvolvimento ela FALA. Em produção continua silenciosa: uma
 * lacuna de telemetria não é problema de quem está usando o produto, e o boundary já mostrou a
 * tela de erro.
 */
export function reportError(error: Error, info: ErrorInfo): void {
  try {
    if (errorsThisSession >= MAX_ERRORS_PER_SESSION) return;
    errorsThisSession++;
    despachar(montarPayload(error, info));
  } catch (falha) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('[error-reporter] failed to report', falha);
    }
    // Em produção, silêncio deliberado — ver o docblock acima.
  }
}

interface PayloadDeErro {
  type: 'react-error';
  message: string;
  stack: string | null;
  componentStack: string | null;
  routePath: string | null;
  timestamp: number;
  userAgent: string | null;
}

function montarPayload(error: Error, info: ErrorInfo): PayloadDeErro {
  return {
    type: 'react-error',
    message: error.message,
    stack: error.stack ?? null,
    componentStack: info.componentStack ?? null,
    routePath: info.routePath ?? null,
    timestamp: Date.now(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  };
}

/**
 * Entrega o payload. Pode lançar — quem chama trata, uma vez só.
 *
 * `sendBeacon` primeiro porque ele sobrevive ao descarregamento da página, que é exatamente
 * quando um erro fatal costuma acontecer; `fetch` com `keepalive` é a alternativa quando não há
 * beacon.
 */
function despachar(payload: PayloadDeErro): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.error('[error-reporter]', payload);
    return;
  }

  const body = JSON.stringify(payload);
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    navigator.sendBeacon('/v1/telemetry/errors', body);
    return;
  }
  if (typeof fetch !== 'undefined') {
    fetch('/v1/telemetry/errors', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      // A rejeição da promise é assíncrona: o `try` de quem chama já terminou quando ela chega, e
      // sem este `.catch` ela vira unhandled rejection — que em alguns ambientes derruba o
      // processo. É a única razão pela qual sobrou mais de um ponto de engolimento neste arquivo.
    }).catch(() => {});
  }
}
