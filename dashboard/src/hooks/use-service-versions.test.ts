// M21 T2.2 — the pure derivation behind the footer indicator and the /status page.
//
// Both consumers (the indicator and the page) derive from THESE functions, which is
// what stops the dot from disagreeing with the list (plan ADR D3 § Consequences).
// The aggregate is an ALLOWLIST (ADR D9): green requires proof, and the absence of
// proof is 'unknown' — never 'operational'.

import { describe, it, expect } from 'vitest';
import { aggregateState, describeStatus, type ServiceStatus } from './use-service-versions';

const at = '2026-07-28T10:00:00Z';
const ok = (name: string, version: string): ServiceStatus => ({ name, state: 'ok', checked_at: at, version });
const down = (name: string): ServiceStatus => ({ name, state: 'unreachable', checked_at: at, reason: 'connection refused' });
const late = (name: string): ServiceStatus => ({ name, state: 'timeout', checked_at: at, reason: 'deadline exceeded' });
const absent = (name: string): ServiceStatus => ({ name, state: 'not_deployed', checked_at: at });

describe('aggregateState', () => {
  it('returns degraded when any service is unreachable', () => {
    expect(aggregateState([ok('theo-rag', '0.35.0'), down('theo-lens'), absent('theo-storage')])).toBe('degraded');
  });

  it('returns degraded when any service timed out', () => {
    expect(aggregateState([ok('theo-rag', '0.35.0'), late('theo-lens')])).toBe('degraded');
  });

  it('ignores not_deployed so an absent service does not pin the dot to amber', () => {
    expect(aggregateState([ok('theo-rag', '0.35.0'), absent('theo-storage')])).toBe('operational');
  });

  it('returns unknown for an empty or missing list', () => {
    expect(aggregateState([])).toBe('unknown');
    expect(aggregateState(undefined)).toBe('unknown');
  });

  // D9 / EC-1 — the two direct paths to 'operational' that a blocklist leaves open.
  it('returns unknown when every service is not_deployed, instead of claiming health nobody measured', () => {
    expect(aggregateState([absent('theo-storage'), absent('theo-rag')])).toBe('unknown');
  });

  it('returns degraded for a state outside the union, because the payload comes from the wire', () => {
    const alien = { name: 'theo-lens', state: 'quarantined', checked_at: at } as unknown as ServiceStatus;
    expect(aggregateState([ok('theo-rag', '0.35.0'), alien])).toBe('degraded');
  });
});

describe('describeStatus', () => {
  it('counts every state in the accessible label, including not_deployed', () => {
    expect(describeStatus([ok('theo-rag', '0.35.0'), down('theo-lens'), absent('theo-storage')]))
      .toBe('System status: 1 operational, 1 unreachable, 1 not deployed');
  });

  it('counts a timeout as unreachable so the label never undercounts a failure', () => {
    expect(describeStatus([late('theo-lens'), absent('theo-storage')]))
      .toBe('System status: 0 operational, 1 unreachable, 1 not deployed');
  });

  // F-web-1 — the same alien payload that `aggregateState` turns amber (line 40
  // above) fell into NO bucket here, so the dot said "Degraded" while the only
  // sentence assistive technology reads announced an all-clear. The lie the
  // milestone removed from the visual channel had simply moved into the AT one.
  it('accounts for a state outside the union, so the dot and the label cannot disagree', () => {
    const alien = { name: 'theo-lens', state: 'quarantined', checked_at: at } as unknown as ServiceStatus;
    expect(describeStatus([ok('theo-rag', '0.35.0'), alien]))
      .toBe('System status: 1 operational, 0 unreachable, 0 not deployed, 1 unknown');
  });

  // The counts are a census, not a sample: whatever the wire sends, they add up.
  it('always sums to the number of services reported', () => {
    const alien = { name: 'theo-lens', state: 'quarantined', checked_at: at } as unknown as ServiceStatus;
    const services = [ok('theo-rag', '0.35.0'), down('theo-memory'), absent('theo-storage'), alien];
    const total = [...describeStatus(services).matchAll(/(\d+)\s/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    expect(total).toBe(services.length);
  });
});

describe('the ServiceStatus union', () => {
  it('does not expose version on a failure variant', () => {
    const s: ServiceStatus = down('theo-lens');
    // @ts-expect-error — D3: `version` only exists on the `ok` variant. If this line
    // ever compiles, the type went back to allowing the lie and typecheck fails here
    // with "Unused '@ts-expect-error' directive".
    const leaked = s.version;
    expect(leaked).toBeUndefined();
  });
});
