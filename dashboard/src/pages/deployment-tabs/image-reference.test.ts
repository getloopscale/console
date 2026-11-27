// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { withoutRegistryHost } from './image-reference';

describe('withoutRegistryHost', () => {
  it('drops an internal registry address', () => {
    expect(withoutRegistryHost('172.29.0.1:9597/loop-runtime-tenants/tn-1/hello-web:1902e9f@sha256:e3bb')).toBe(
      'loop-runtime-tenants/tn-1/hello-web:1902e9f@sha256:e3bb',
    );
  });

  it('drops a registry domain', () => {
    expect(withoutRegistryHost('123456789012.dkr.ecr.us-east-1.amazonaws.com/tenants/app@sha256:ab')).toBe(
      'tenants/app@sha256:ab',
    );
    expect(withoutRegistryHost('localhost/app:1')).toBe('app:1');
  });

  it('keeps a reference that names no host', () => {
    expect(withoutRegistryHost('tenants/app:1')).toBe('tenants/app:1');
    expect(withoutRegistryHost('app')).toBe('app');
  });
});
