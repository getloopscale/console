/**
 * How the Status screen writes what an app consumes. The API sends CPU in cores and memory in
 * bytes, each summed over the pods of the environment, with the limit over the same pods.
 */

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Trailing zeros carry no information: 1.50 reads as 1.5. */
const trimmed = (v: number, decimals: number): string => String(Number(v.toFixed(decimals)));

/** CPU in vCPU. An idle app uses a few ten-thousandths of a core, which must not read as zero. */
export function formatCpu(cores: unknown): string | null {
  if (!finite(cores) || cores < 0) return null;
  if (cores === 0) return '0 vCPU';
  if (cores < 0.001) return '<0.001 vCPU';
  if (cores < 0.1) return `${trimmed(cores, 3)} vCPU`;
  if (cores < 10) return `${trimmed(cores, 2)} vCPU`;
  return `${trimmed(cores, 1)} vCPU`;
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;

/** The largest binary unit that keeps the value at 1 or more, as a number of bytes and a name. */
export function byteUnit(bytes: number): { size: number; name: (typeof BYTE_UNITS)[number] } {
  let index = 0;
  let size = 1;
  while (index < BYTE_UNITS.length - 1 && Math.abs(bytes) >= size * 1024) {
    size *= 1024;
    index += 1;
  }
  return { size, name: BYTE_UNITS[index] };
}

/** Memory in binary units, the ones a Kubernetes limit is written in (512Mi is 512 MiB). */
export function formatBytes(bytes: unknown): string | null {
  if (!finite(bytes) || bytes < 0) return null;
  const { size, name } = byteUnit(bytes);
  const value = bytes / size;
  return `${value < 10 ? trimmed(value, 1) : Math.round(value)} ${name}`;
}

/** Whole restarts. The series is an increase over an hour, which Prometheus extrapolates. */
export function formatRestarts(count: unknown): string | null {
  if (!finite(count) || count < 0) return null;
  return String(Math.round(count));
}

/** Usage as a percentage of the limit, or `null` when there is no limit to fill. */
export function usageShare(usage: unknown, limit: unknown): number | null {
  if (!finite(usage) || !finite(limit) || limit <= 0 || usage < 0) return null;
  return (usage / limit) * 100;
}

export function formatShare(share: number | null): string | null {
  if (share === null || !Number.isFinite(share)) return null;
  if (share === 0) return '0%';
  if (share < 0.1) return '<0.1%';
  return `${share < 10 ? trimmed(share, 1) : Math.round(share)}%`;
}

export type UsageBand = 'ok' | 'high' | 'critical' | 'unknown';

/**
 * Where usage stands against its limit. At the memory limit the kernel kills the container and at
 * the CPU limit it throttles, so the last tenth is the one that needs a person.
 */
export function usageBand(share: number | null): UsageBand {
  if (share === null || !Number.isFinite(share)) return 'unknown';
  if (share < 70) return 'ok';
  if (share < 90) return 'high';
  return 'critical';
}

export const USAGE_BAND_LABEL: Record<UsageBand, string> = {
  ok: 'Within limit',
  high: 'High',
  critical: 'Near limit',
  unknown: 'No limit set',
};
