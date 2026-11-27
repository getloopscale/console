// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  byteUnit,
  formatBytes,
  formatCpu,
  formatRestarts,
  formatShare,
  usageBand,
  usageShare,
} from './resource-format';

describe('formatCpu', () => {
  it('keeps an idle app from reading as zero', () => {
    expect(formatCpu(0.0002)).toBe('<0.001 vCPU');
    expect(formatCpu(0)).toBe('0 vCPU');
  });

  it('writes fewer decimals as the value grows', () => {
    expect(formatCpu(0.0123)).toBe('0.012 vCPU');
    expect(formatCpu(0.25)).toBe('0.25 vCPU');
    expect(formatCpu(1.5)).toBe('1.5 vCPU');
    expect(formatCpu(12.34)).toBe('12.3 vCPU');
  });

  it('has no text for a value that is not a usage', () => {
    expect(formatCpu(Number.NaN)).toBeNull();
    expect(formatCpu(-1)).toBeNull();
    expect(formatCpu(undefined)).toBeNull();
  });
});

describe('formatBytes', () => {
  it('uses the binary unit a Kubernetes limit is written in', () => {
    expect(formatBytes(536870912)).toBe('512 MiB');
    expect(formatBytes(1610612736)).toBe('1.5 GiB');
    expect(formatBytes(11345920)).toBe('11 MiB');
    expect(formatBytes(9.5 * 1024 * 1024)).toBe('9.5 MiB');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(0)).toBe('0 B');
  });

  it('has no text for a value that is not a size', () => {
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBeNull();
    expect(formatBytes(null)).toBeNull();
  });

  it('names the unit of a value', () => {
    expect(byteUnit(1024 * 1024)).toEqual({ size: 1024 * 1024, name: 'MiB' });
    expect(byteUnit(1023)).toEqual({ size: 1, name: 'B' });
  });
});

describe('formatRestarts', () => {
  it('rounds the extrapolated increase to whole restarts', () => {
    expect(formatRestarts(2.03)).toBe('2');
    expect(formatRestarts(0)).toBe('0');
    expect(formatRestarts(Number.NaN)).toBeNull();
  });
});

describe('usageShare', () => {
  it('is the usage as a percentage of the limit', () => {
    expect(usageShare(256, 512)).toBe(50);
    expect(usageShare(0, 512)).toBe(0);
  });

  it('is null when there is no limit to fill', () => {
    expect(usageShare(256, 0)).toBeNull();
    expect(usageShare(256, null)).toBeNull();
    expect(usageShare(null, 512)).toBeNull();
  });

  it('reads as text', () => {
    expect(formatShare(0.04)).toBe('<0.1%');
    expect(formatShare(2.19)).toBe('2.2%');
    expect(formatShare(71.6)).toBe('72%');
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(null)).toBeNull();
  });
});

describe('usageBand', () => {
  it('changes at 70% and at 90% of the limit', () => {
    expect(usageBand(69.9)).toBe('ok');
    expect(usageBand(70)).toBe('high');
    expect(usageBand(89.9)).toBe('high');
    expect(usageBand(90)).toBe('critical');
    expect(usageBand(140)).toBe('critical');
  });

  it('is unknown without a limit', () => {
    expect(usageBand(null)).toBe('unknown');
  });
});
