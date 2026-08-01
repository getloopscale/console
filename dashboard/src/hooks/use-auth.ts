import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSession, type Session } from '@/lib/auth';
import { exchangeSessionToken, hasValidToken, sessionDefinitivelyExpired } from '@/lib/api';

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
