import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSession, type Session } from '@/lib/auth/session';
import { sessionDefinitivelyExpired } from '@/lib/http/api';
import { takePendingAttempt } from '@/hooks/auth/auth-attempt';
import { reportEvent, viewportBucket } from '@/lib/telemetry/rum';

/** Check the Kratos session through the BFF. Redirects to /login if it has ended. */
export function useRequireAuth(): Session | null {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    async function init() {
      const s = await getSession();
      if (!s) {
        // B-140 — `getSession()` returns `null` for THREE reasons: the session probe was not ok,
        // it answered 200 with no identity, or the network/parse failed. Only the first, and only
        // when the status was 401, means the session ENDED. Sending someone to /login on a
        // transient failure is false AND feeds itself: the navigation remounts the tree and probes
        // the endpoint that just failed.
        //
        // Numa falha transitória a tela fica montada sem sessão; quem consome decide o que
        // mostrar, e o próximo `cloudFetch` tenta de novo. Isso é melhor do que mandar alguém
        // logado para o login por causa de um 502.
        if (sessionDefinitivelyExpired()) {
          navigate('/login', { replace: true });
        }
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

      setChecked(true);
    }
    init();
  }, [navigate]);

  if (!checked) return null; // Still loading
  return session;
}
