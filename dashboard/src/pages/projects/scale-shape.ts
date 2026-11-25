import type { ProjectStatusDetail } from '@/lib/api/types';

/** How an app is scaled: a fixed replica count, or a range an autoscaler moves within. */
export type ScaleShape =
  | { kind: 'fixed'; replicas: number }
  | { kind: 'auto'; min: number; max: number };

type ScaleStatus = Pick<ProjectStatusDetail, 'scaling' | 'replicas_desired'>;

/**
 * The scale the API reports for the environment, or `null` when it reports none. A range, or
 * scale to zero, is autoscaling; equal bounds are a fixed count.
 */
export function shapeOfStatus(status: ScaleStatus | null | undefined): ScaleShape | null {
  const scaling = status?.scaling;
  if (scaling) {
    if (scaling.scaled_to_zero || scaling.min < scaling.max) {
      return { kind: 'auto', min: scaling.min, max: scaling.max };
    }
    return { kind: 'fixed', replicas: scaling.replicas };
  }
  if (typeof status?.replicas_desired === 'number') {
    return { kind: 'fixed', replicas: status.replicas_desired };
  }
  return null;
}

function replicaWord(count: number): string {
  return count === 1 ? 'replica' : 'replicas';
}

export function describeScaleShape(shape: ScaleShape): string {
  if (shape.kind === 'fixed') return `${shape.replicas} ${replicaWord(shape.replicas)}`;
  return `autoscaling, ${shape.min} to ${shape.max} replicas`;
}

function sameShape(a: ScaleShape, b: ScaleShape): boolean {
  if (a.kind === 'fixed' && b.kind === 'fixed') return a.replicas === b.replicas;
  if (a.kind === 'auto' && b.kind === 'auto') return a.min === b.min && a.max === b.max;
  return false;
}

/**
 * The sentence the confirmation shows after "Apply scale to <environment>:". With no current
 * scale reported it names only the target and claims no direction.
 */
export function describeScaleChange(current: ScaleShape | null, proposed: ScaleShape): string {
  if (current === null) return `to ${describeScaleShape(proposed)}.`;
  if (current.kind === 'fixed' && proposed.kind === 'fixed') {
    const delta = proposed.replicas - current.replicas;
    const direction = delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'no change';
    return `${current.replicas} → ${proposed.replicas} replicas (${direction}).`;
  }
  if (sameShape(current, proposed)) return `${describeScaleShape(proposed)} (no change).`;
  return `from ${describeScaleShape(current)} to ${describeScaleShape(proposed)}.`;
}
