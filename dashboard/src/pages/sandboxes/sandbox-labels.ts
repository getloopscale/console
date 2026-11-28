import { ApiError } from '@/lib/http/api';

/** The badge colour of each sandbox state. */
export const STATE_VARIANTS: Record<string, 'default' | 'success' | 'warning'> = {
  running: 'success',
  paused: 'warning',
  pending: 'default',
};

/** A sandbox reaches the public internet unless it has outbound rules. */
export function outboundNetwork(rules: { allow_out?: string[]; deny_out?: string[] } | undefined): string {
  const restricted = (rules?.allow_out?.length ?? 0) > 0 || (rules?.deny_out?.length ?? 0) > 0;
  return restricted ? 'Restricted' : 'Open internet';
}

/**
 * The sentence to show for a failed sandbox call. The sandbox service answers
 * `{ error: { code, message } }`, and that message says what to do, so it wins
 * over the generic text of the error.
 */
export function sandboxFailure(err: unknown): string {
  if (err instanceof ApiError) {
    const message = (err.body as { error?: { message?: unknown } } | null | undefined)?.error?.message;
    if (typeof message === 'string' && message !== '') return message;
  }
  return err instanceof Error ? err.message : 'The request failed.';
}
