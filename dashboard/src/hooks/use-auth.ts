import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSession, type Session } from '@/lib/auth';
import { exchangeSessionToken, hasValidToken, wasLastExchangeRateLimited } from '@/lib/api';

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
          // #324: `!ok` sozinho nao decide. Sob rate limit (429) a sessao
          // Kratos segue valida — mandar para /login e falso E realimenta a
          // cota, porque a navegacao remonta a arvore e refaz a troca. So o
          // fracasso NAO-temporario (cookie velho, #110 acima) justifica sair.
          if (!ok && !wasLastExchangeRateLimited()) {
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
