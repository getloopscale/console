import { useEffect, useState } from 'react';

/**
 * The current time in epoch ms, read again every `intervalMs`. A time written relative to now
 * ("2 minutes ago") must take this value as its input: the React Compiler keeps a computation
 * whose inputs did not change, so a re-render alone leaves the text as it was.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
