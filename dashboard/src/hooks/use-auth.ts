import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSession, type Session } from '@/lib/auth';
import { exchangeSessionToken, hasValidToken } from '@/lib/api';

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
      // Red Team theo-cloud#50 closure: previously this awaited the
      // JWT exchange before flipping `checked` to true, serializing
      // TWO blocking network calls (Kratos /sessions/whoami + the
      // BFF /v1/auth/exchange) on every page load. The exchange is
      // NOT required for the page shell to render — `cloudFetch` /
      // `engineFetch` call `ensureToken()` which lazily exchanges
      // on first use. Kick off the exchange in the background so the
      // shell paints at session-detect (one RTT, not two). Data
      // fetchers only block on the exchange if it's still in flight
      // when they fire, which the cached-token branch handles.
      if (!hasValidToken()) {
        void exchangeSessionToken();
      }
      setChecked(true);
    }
    init();
  }, [navigate]);

  if (!checked) return null; // Still loading
  return session;
}
