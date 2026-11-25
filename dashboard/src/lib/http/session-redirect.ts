import { safeNavigator } from '@/lib/navigation';

/**
 * Levar alguem de volta ao login quando a sessao acaba — e admitir quando isso NAO acontece.
 *
 * ## Por que fora de `api.ts`
 *
 * Isto e politica de NAVEGACAO, nao transporte HTTP: quando redirecionar, quanto tempo o aviso
 * fica, e o que fazer quando o destino e recusado. Ficou no cliente HTTP por proximidade
 * historica, e a revisao de B-218 mostrou o custo — o transporte chegou a montar o `<div>` do
 * aviso e a estiliza-lo por `cssText`. O arquivo tambem estava no teto do orcamento de LoC, e a
 * catraca manda decompor em vez de subir o numero.
 *
 * ## O sinal flui para frente
 *
 * `safeNavigator.goTo` JULGA o destino e devolve `false` quando recusa. A primeira versao
 * descartava esse retorno, e o componente do aviso reconstruia o mesmo fato correndo um
 * temporizador contra a propria desmontagem — numa aba em segundo plano, onde o browser adia
 * timers, isso mostrava "nao deu certo" por cima de um redirect que ainda ia acontecer. A camada
 * que SABE agora avisa, num segundo evento.
 *
 * O latch `redirecting` existe para nao empilhar redirects. Recusado, ele TEM de reabrir: mante-lo
 * fechado desabilitava para sempre o redirect de login daquela aba, e a unica recuperacao virava
 * um reload manual.
 */

/** Quanto o aviso de sessao expirada fica na tela antes da navegacao. */
const SESSION_EXPIRY_NOTICE_MS = 2000;

let redirecting = false;

export function redirectToLogin(reason?: string): void {
  if (redirecting) return;
  redirecting = true;
  const params = reason ? `?reason=${reason}` : '';

  // `goTo` DEVOLVE a recusa; descartar isso deixava calada a unica camada que sabe. Recusado, o
  // latch TEM de abrir — fechado, desabilita para sempre o redirect desta aba.
  const navegar = (): void => {
    if (safeNavigator.goTo(`/login${params}`)) return;
    redirecting = false;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('loopscale:session-redirect-refused'));
    }
  };

  if (reason !== 'expired') { navegar(); return; }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('loopscale:session-expired'));
  }
  setTimeout(navegar, SESSION_EXPIRY_NOTICE_MS);
}
