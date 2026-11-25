// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { RULES, readCustomDomain, readMeasurements, type Measurements } from './readiness-rules';

const measurements = (over: Partial<Measurements> = {}): Measurements => ({
  projectUnavailable: false,
  statusUnavailable: false,
  readyReplicas: 0,
  activeAlerts: 0,
  errorRate5xx1h: 0,
  repositoryConnected: null,
  secretCount: null,
  customDomain: null,
  ...over,
});

describe('logs_healthy: the three 5xx bands', () => {
  // These bands had no test of their own: exercising them meant mounting the hook and mocking the
  // composed hooks, so only the `pass` band was covered in practice.
  it.each([
    [0, 'pass'],
    [0.009, 'pass'],
    [0.01, 'warn'],
    [0.049, 'warn'],
    [0.05, 'fail'],
    [1, 'fail'],
  ])('5xx of %s%% => %s', (pct, expected) => {
    expect(RULES.logs_healthy(measurements({ errorRate5xx1h: pct as number }))).toBe(expected);
  });

  it('an unavailable status wins over the band, so the project is not blamed for our failure', () => {
    expect(RULES.logs_healthy(measurements({ statusUnavailable: true, errorRate5xx1h: 1 }))).toBe('unknown');
  });

  it('is unknown, not healthy, when the status carries no 5xx rate', () => {
    expect(RULES.logs_healthy(measurements({ errorRate5xx1h: null }))).toBe('unknown');
  });
});

describe('two_plus_replicas counts replicas actually serving', () => {
  it('one ready replica is not two serving', () => {
    expect(RULES.two_plus_replicas(measurements({ readyReplicas: 1 }))).toBe('fail');
  });

  it('the boundary is 2, not 3', () => {
    expect(RULES.two_plus_replicas(measurements({ readyReplicas: 2 }))).toBe('pass');
  });

  it('is unknown, not failed, when the status carries no ready count', () => {
    expect(RULES.two_plus_replicas(measurements({ readyReplicas: null }))).toBe('unknown');
  });
});

describe('hpa_configured reads an HPA, and the API reports none', () => {
  it('is unknown whatever the replica counts are', () => {
    // More than one desired replica used to count as "an HPA exists". Two fixed replicas are not
    // autoscaling, and the status response has no HPA field to read instead.
    expect(RULES.hpa_configured(measurements({ readyReplicas: 5 }))).toBe('unknown');
    expect(RULES.hpa_configured(measurements({ readyReplicas: 1 }))).toBe('unknown');
  });
});

describe('alerts_configured: zero is ambiguous, so it is not a fail', () => {
  it('alerts firing prove alerts exist', () => {
    expect(RULES.alerts_configured(measurements({ activeAlerts: 1 }))).toBe('warn');
  });

  it('zero active alerts stays unknown', () => {
    // No alert configured and everything healthy produce the same zero. `fail` would accuse half
    // the healthy projects of being misconfigured.
    expect(RULES.alerts_configured(measurements({ activeAlerts: 0 }))).toBe('unknown');
  });

  it('a missing alert count stays unknown', () => {
    expect(RULES.alerts_configured(measurements({ activeAlerts: null }))).toBe('unknown');
  });
});

describe('what cannot be measured stays unknown, never fail', () => {
  it('cache_hit_rate is unknown until the API reports a hit rate, builds or not', () => {
    expect(RULES.cache_hit_rate(measurements())).toBe('unknown');
  });
});

describe('auto_deploy reads the repository connection, not the last deploy', () => {
  it('fails when GET /projects/{name}/connect says no repository, even after a CLI deploy', () => {
    // Staging: a CLI deploy set last_deploy and the old proxy passed with no repository connected.
    expect(RULES.auto_deploy(measurements({ repositoryConnected: false }))).toBe('fail');
  });

  it('passes when a repository is connected', () => {
    expect(RULES.auto_deploy(measurements({ repositoryConnected: true }))).toBe('pass');
  });

  it('is unknown when the connection could not be read', () => {
    expect(RULES.auto_deploy(measurements({ repositoryConnected: null }))).toBe('unknown');
  });

  it('is unknown without the project row, not fail', () => {
    // The cross-tenant probe answers 401 and the project does not resolve.
    expect(
      RULES.auto_deploy(measurements({ projectUnavailable: true, repositoryConnected: false })),
    ).toBe('unknown');
  });
});

describe('secrets_rotated counts the secrets GET /secrets lists', () => {
  it('passes with at least one secret and fails with none', () => {
    expect(RULES.secrets_rotated(measurements({ secretCount: 1 }))).toBe('pass');
    expect(RULES.secrets_rotated(measurements({ secretCount: 0 }))).toBe('fail');
  });

  it('is unknown when the list could not be read', () => {
    expect(RULES.secrets_rotated(measurements({ secretCount: null }))).toBe('unknown');
  });
});

describe('custom_domain reads the project domains from GET /domains', () => {
  it('passes with a verified domain and fails with none or only unverified ones', () => {
    expect(RULES.custom_domain(measurements({ customDomain: 'verified' }))).toBe('pass');
    expect(RULES.custom_domain(measurements({ customDomain: 'unverified' }))).toBe('fail');
    expect(RULES.custom_domain(measurements({ customDomain: 'none' }))).toBe('fail');
  });

  it('is unknown when the list could not be read', () => {
    expect(RULES.custom_domain(measurements({ customDomain: null }))).toBe('unknown');
  });
});

describe('readCustomDomain', () => {
  const row = (project: string, status: string) => ({ project, status });

  it('only counts the domains of this project', () => {
    expect(readCustomDomain('loop-app', { domains: [row('other', 'verified')], total: 1 })).toBe('none');
    expect(readCustomDomain('loop-app', { domains: [row('loop-app', 'active')], total: 1 })).toBe('verified');
    expect(
      readCustomDomain('loop-app', { domains: [row('loop-app', 'pending_verification')], total: 1 }),
    ).toBe('unverified');
  });

  it('is not measured when the request failed or the list was cut short', () => {
    expect(readCustomDomain('loop-app', undefined)).toBeNull();
    expect(readCustomDomain('loop-app', { domains: [row('other', 'verified')], total: 500 })).toBeNull();
  });
});

describe('readMeasurements', () => {
  it('a missing status body is unavailability, even without an error', () => {
    // Both causes, the hook failed or answered with no body, lead to the same reading: not measured.
    expect(readMeasurements({ project: {}, statusError: null, status: null }).statusUnavailable).toBe(true);
    expect(
      readMeasurements({ project: {}, statusError: new Error('x'), status: { replicas_ready: 3 } })
        .statusUnavailable,
    ).toBe(true);
  });

  it('reads a field the status does not carry as not measured, never as zero', () => {
    // The staging status for a project serving 2 ready replicas carried no replica or 5xx field.
    const m = readMeasurements({ project: {}, statusError: null, status: {} });
    expect(m.statusUnavailable).toBe(false);
    expect(m.readyReplicas).toBeNull();
    expect(m.activeAlerts).toBeNull();
    expect(m.errorRate5xx1h).toBeNull();
  });

  it('keeps a reported zero as a measurement', () => {
    const m = readMeasurements({
      project: {},
      statusError: null,
      status: { replicas_ready: 0, alerts_active: 0, traffic_5xx_pct_1h: 0 },
    });
    expect(m.readyReplicas).toBe(0);
    expect(m.activeAlerts).toBe(0);
    expect(m.errorRate5xx1h).toBe(0);
  });
});
