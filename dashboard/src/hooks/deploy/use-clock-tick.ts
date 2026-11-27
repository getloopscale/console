import { useEffect, useState } from 'react';

/**
 * Re-renders the caller every `intervalMs`, so a time written relative to now ("2 minutes ago")
 * keeps moving while the page stays open. Returns the number of ticks so far.
 */
export function useClockTick(intervalMs: number): number {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTicks((n) => n + 1), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return ticks;
}
