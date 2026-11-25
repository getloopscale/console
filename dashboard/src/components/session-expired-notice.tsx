import { useEffect, useState } from 'react';

/**
 * O aviso que aparece quando a sessão termina, antes da navegação para o login (B-218).
 *
 * ## De onde ele veio
 *
 * De dentro do cliente HTTP. `api.ts` montava um `<div>`, escrevia treze declarações de CSS num
 * `cssText` — cor de fundo, sombra, z-index — e esperava `2000` literais antes de navegar.
 *
 * Três custos, todos medidos e nenhum teórico: o transporte deixava de ser testável sem um
 * `document`; o visual do aviso não podia mudar sem editar o cliente de rede; e o atraso, que é
 * uma decisão de produto, ficava fixado numa camada sem legitimidade para tomá-la.
 *
 * O precedente estava no MESMO arquivo: `maybeEmitPaymentRequired` já anunciava um evento e
 * deixava `PlanLimitUpgradeModal` decidir o que aparece. Esta é a segunda aplicação da mesma
 * ideia, não uma invenção.
 *
 * ## Por que a navegação NÃO veio junto
 *
 * Ela tem de acontecer mesmo que ninguém esteja ouvindo. Uma sessão pode expirar numa rota
 * renderizada fora da árvore onde este componente está montado, e nesse caso um aviso que não
 * aparece é aceitável — uma pessoa presa numa tela morta não é. O transporte agenda a navegação;
 * este componente só ocupa a janela até ela.
 *
 * E quando a navegação é RECUSADA — `safeNavigator.goTo` julga o destino e devolve `false` —, é o
 * transporte que avisa, num segundo evento. Este componente não infere nada.
 */
export function SessionExpiredNotice() {
  const [visivel, setVisivel] = useState(false);
  const [redirecionouFalhou, setRedirecionouFalhou] = useState(false);

  useEffect(() => {
    const onExpire = () => { setVisivel(true); };
    window.addEventListener('loopscale:session-expired', onExpire);
    return () => { window.removeEventListener('loopscale:session-expired', onExpire); };
  }, []);

  useEffect(() => {
    // O transporte AVISA quando a navegação foi recusada, em vez de este componente inferir isso
    // correndo um temporizador contra a própria desmontagem.
    //
    // A primeira versão fazia exatamente essa inferência, e a revisão a derrubou com um caso
    // concreto: numa aba em segundo plano o browser adia `setTimeout`, então o aviso mostrava
    // "não deu certo" por cima de um redirect que ainda ia acontecer — e, ao contrário, uma
    // recusa que `safeNavigator.goTo` relatou no ato só aparecia 1,5 s depois. A informação
    // fluía para trás: a camada que SABE ficava calada e a que NÃO PODE saber adivinhava.
    const onReject = () => { setRedirecionouFalhou(true); };
    window.addEventListener('loopscale:session-redirect-refused', onReject);
    return () => { window.removeEventListener('loopscale:session-redirect-refused', onReject); };
  }, []);

  if (!visivel) return null;

  if (redirecionouFalhou) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed right-4 top-4 z-50 rounded-lg bg-foreground px-5 py-3 text-sm text-background shadow-lg"
      >
        Session expired.{' '}
        <a href="/login?reason=expired" className="underline underline-offset-4">
          Sign in again
        </a>
      </div>
    );
  }

  return (
    // `role="status"` e não `alert`: o aviso acompanha uma navegação que já está agendada, então
    // ele informa, não interrompe. `aria-live="polite"` deixa o leitor de tela terminar a frase em
    // curso antes de anunciá-lo — cortar a leitura de alguém para dizer que a sessão acabou é
    // exatamente a hora errada de interromper.
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 top-4 z-50 rounded-lg bg-foreground px-5 py-3 text-sm text-background shadow-lg"
    >
      Session expired. Redirecting to login...
    </div>
  );
}
