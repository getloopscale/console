import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSession, type Session } from '@/lib/auth/session';
import { exchangeSessionToken, hasValidToken, sessionDefinitivelyExpired } from '@/lib/http/api';
import { takePendingAttempt } from '@/hooks/auth/auth-attempt';
import { reportEvent, viewportBucket } from '@/lib/telemetry/rum';

/** Check Kratos session + exchange for JWT. Redirects to /login if not authenticated. */
export function useRequireAuth(): Session | null {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    async function init() {
      const s = await getSession();
      if (!s) {
        navigate('/login', { replace: true });
        setChecked(true);
        return;
      }
      setSession(s);

      /**
       * B-096 — o desfecho da tentativa de login, do outro lado da navegacao.
       *
       * `auth.method.success` estava declarado desde 2026-05-29 e nunca era
       * emitido: o login usa `form.submit()` (exigencia do Kratos para o
       * redirect OIDC), a pagina navega, e o correlation_id vivia num useRef.
       * Media-se quem TENTOU entrar e ninguem que ENTROU.
       *
       * Este e o ponto certo porque e a primeira coisa que roda com sessao
       * confirmada, independente da rota de destino — o Kratos manda para `/`,
       * para `?return_to=`, ou para onde o OIDC decidir. E vem DEPOIS da guarda
       * `if (!s)`: emitir antes dela contaria uma sessao invalida como login bem
       * sucedido, que e o pior erro possivel nesta metrica.
       *
       * `takePendingAttempt` e de leitura unica, entao os outros renders
       * autenticados (todo F5, toda navegacao) nao encontram nada e nao emitem.
       */
      const tentativa = takePendingAttempt();
      if (tentativa) {
        reportEvent('auth.method.success', {
          v: 1,
          method: tentativa.method,
          correlation_id: tentativa.correlation_id,
          latency_ms: Math.max(0, Date.now() - tentativa.started_at),
          viewport_bucket: viewportBucket(),
          timestamp: Date.now(),
        });
      }

      // Defer the JWT exchange so the shell paints at session-detect
      // (one RTT, not two). But watch the resolution: a stale Kratos
      // cookie returns `false` here, and without redirecting to /login
      // every cloudFetch/engineFetch retries 401 forever — the dashboard
      // hangs in "Loading". Closes Red Team theo-cloud#110.
      if (!hasValidToken()) {
        exchangeSessionToken().then((ok) => {
          // #324: `!ok` sozinho nao decide. A troca falha por 429, 5xx, 502 ou
          // rejeicao de rede sem que a sessao Kratos tenha acabado — mandar
          // para /login nesses casos e falso E realimenta o problema, porque a
          // navegacao remonta a arvore e refaz a troca. So o 401 (cookie velho,
          // #110 acima) justifica sair.
          if (!ok && sessionDefinitivelyExpired()) {
            navigate('/login', { replace: true });
          }
        });
      }
      setChecked(true);
    }
    init();
  }, [navigate]);

  if (!checked) return null; // Still loading
  return session;
}
