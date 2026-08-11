import { useEffect, useState } from 'react';
import { SESSION_EXPIRY_NOTICE_MS } from '@/lib/http/event-payloads';

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
 * `SESSION_EXPIRY_NOTICE_MS` é compartilhado exatamente por isso: se os dois lados escolhessem
 * o próprio número, o aviso sumiria antes ou depois da navegação e não haveria como saber qual
 * dos dois estava errado.
 */
/**
 * Margem sobre a janela do aviso antes de admitir que a navegação não aconteceu.
 *
 * Existe porque `safeNavigator.goTo` PODE recusar (ele julga o destino — ver B-138), e um
 * `setTimeout` pode ser adiado numa aba em segundo plano. Sem esta segunda fase, o aviso ficaria
 * para sempre dizendo "Redirecting to login..." enquanto nada redireciona — uma frase que afirma
 * um futuro que não vai acontecer, que é a mesma classe de mentira que esta varredura inteira
 * está corrigindo em outras telas.
 */
const GRACE_MS = 1500;

export function SessionExpiredNotice() {
  const [visivel, setVisivel] = useState(false);
  const [redirecionouFalhou, setRedirecionouFalhou] = useState(false);

  useEffect(() => {
    const aoExpirar = () => { setVisivel(true); };
    window.addEventListener('theo:session-expired', aoExpirar);
    return () => { window.removeEventListener('theo:session-expired', aoExpirar); };
  }, []);

  useEffect(() => {
    if (!visivel) return;
    // Se este componente ainda está montado depois da janela inteira, a navegação não levou —
    // este componente vive na árvore que a navegação desmontaria.
    const t = setTimeout(() => { setRedirecionouFalhou(true); }, SESSION_EXPIRY_NOTICE_MS + GRACE_MS);
    return () => { clearTimeout(t); };
  }, [visivel]);

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
