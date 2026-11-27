// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { domainsRefetchInterval } from './domains-refetch-interval';

const list = (...statuses: string[]) => ({
  domains: statuses.map((status, i) => ({ id: `dom-${i}`, status })),
  total: statuses.length,
});

// After "Verify" the platform moves the domain on its own: verified, provisioning, active.
// Nothing re-read the list, so the row stayed "Verified" until a reload.
describe('domainsRefetchInterval', () => {
  it.each(['verified', 'provisioning', 'removing'])('re-reads the list while a domain is %s', (status) => {
    expect(domainsRefetchInterval(list('active', status))).toBe(5_000);
  });

  it('stops once every domain rests', () => {
    expect(domainsRefetchInterval(list('active', 'failed', 'pending_verification'))).toBe(false);
  });

  it('stops when there is no list', () => {
    expect(domainsRefetchInterval(undefined)).toBe(false);
    expect(domainsRefetchInterval(null)).toBe(false);
  });
});
