/** The states the platform leaves on its own, with no action from the user. */
const MOVING_STATUSES: ReadonlySet<string> = new Set(['verified', 'provisioning', 'removing']);

/**
 * How often the list is read again: every 5 seconds while a domain is in a state the platform
 * leaves by itself, never otherwise. A domain waiting for DNS moves when the user clicks Verify,
 * which already re-reads the list.
 */
export function domainsRefetchInterval(
  data: { domains: ReadonlyArray<{ status: string }> } | null | undefined,
): number | false {
  return data?.domains.some((d) => MOVING_STATUSES.has(d.status)) ? 5_000 : false;
}
