import { useCallback, useEffect, useState } from 'react';

/**
 * ResendCooldownButton — M0 J-03 T1.1.
 *
 * A "resend verification email" affordance that enforces a cooldown (default
 * 60s) PERSISTED in localStorage, so the countdown survives a page reload /
 * remount and a user cannot spam Kratos's courier with resend requests. When
 * the cooldown elapses the button re-enables itself.
 *
 * The deadline (epoch ms) is the single source of truth in localStorage; the
 * component derives the remaining seconds from it live, so a reload or remount
 * reconstructs the exact countdown with no accumulator drift. (An already-idle
 * tab does not live-update from a resend started in another tab — it has no
 * running interval — but the click-time re-read below blocks cross-tab spam
 * regardless.) Dev/test time is deterministic via the caller's clock (the
 * component only reads Date.now()).
 */
export interface ResendCooldownButtonProps {
  /** Invoked when the user clicks while NOT in cooldown. */
  onResend: () => void;
  /** Cooldown length in seconds. Default 60. */
  cooldownSeconds?: number;
  /** localStorage key holding the cooldown deadline (epoch ms). */
  storageKey?: string;
  /** Label shown when the button is ready to resend. */
  idleLabel?: string;
}

const DEFAULT_KEY = 'theo-verify-resend-until';

/** Remaining whole seconds of cooldown per the stored deadline (0 = ready). */
function readRemaining(storageKey: string): number {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return 0;
    const until = parseInt(raw, 10);
    if (Number.isNaN(until)) return 0;
    const remainingMs = until - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  } catch {
    return 0;
  }
}

export function ResendCooldownButton({
  onResend,
  cooldownSeconds = 60,
  storageKey = DEFAULT_KEY,
  idleLabel = "Didn't receive the email? Resend",
}: ResendCooldownButtonProps) {
  const [remaining, setRemaining] = useState(() => readRemaining(storageKey));
  const inCooldown = remaining > 0;

  // Tick only while a cooldown is active; the effect re-subscribes exactly
  // twice per cooldown (false→true on start, true→false at zero), not per tick.
  useEffect(() => {
    if (!inCooldown) return;
    const id = setInterval(() => setRemaining(readRemaining(storageKey)), 1000);
    return () => clearInterval(id);
  }, [inCooldown, storageKey]);

  // Clear the stored deadline once it has fully elapsed so a later mount reads
  // "ready" without a stale key lingering.
  useEffect(() => {
    if (!inCooldown) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    }
  }, [inCooldown, storageKey]);

  const handleClick = useCallback(() => {
    if (readRemaining(storageKey) > 0) return; // defense-in-depth vs a stale render
    try {
      localStorage.setItem(storageKey, String(Date.now() + cooldownSeconds * 1000));
    } catch {
      /* localStorage full / disabled — proceed without persistence */
    }
    setRemaining(cooldownSeconds);
    onResend();
  }, [cooldownSeconds, storageKey, onResend]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={inCooldown}
      aria-label={inCooldown ? `Resend available in ${remaining} seconds` : idleLabel}
      className="text-label text-muted-foreground hover:text-foreground underline-offset-2 hover:underline mt-2 disabled:opacity-60 disabled:no-underline disabled:cursor-not-allowed"
    >
      {inCooldown ? `Resend available in ${remaining}s` : idleLabel}
    </button>
  );
}
