// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  rollbackPath,
  rollbackPhases,
  rollbacksOfBuild,
  secondsBetween,
  shortRef,
} from './rollback-status';

describe('rollbackPhases', () => {
  it('shows both phases completed for a rollback that succeeded', () => {
    expect(rollbackPhases('succeeded').map((p) => p.state)).toEqual(['completed', 'completed']);
  });

  it('shows the deploy in progress and live pending while it runs', () => {
    expect(rollbackPhases('in_progress').map((p) => p.state)).toEqual(['in_progress', 'pending']);
  });

  it('shows the deploy failed and live not reached for a failed rollback', () => {
    const phases = rollbackPhases('failed');
    expect(phases.map((p) => p.state)).toEqual(['failed', 'not_reached']);
    expect(phases[1].label).toContain('previous release stayed active');
  });

  it('does not claim a failure for an interrupted rollback', () => {
    expect(rollbackPhases('interrupted').map((p) => p.label)).toEqual(['Interrupted', 'Not confirmed']);
  });
});

describe('rollback helpers', () => {
  it('names a target by its commit, or by its build id when the commit is unknown', () => {
    expect(shortRef('abcdef1234567', 'build-0011223344')).toBe('abcdef1');
    expect(shortRef(undefined, 'build-0011223344')).toBe('0011223');
  });

  it('builds the path of the rollback page', () => {
    expect(rollbackPath('my app', 'rb-1')).toBe('/projects/my%20app/deployments/rollbacks/rb-1');
  });

  it('measures a finished rollback and leaves an unfinished one unmeasured', () => {
    expect(secondsBetween('2026-11-25T19:43:42Z', '2026-11-25T19:44:53Z')).toBe(71);
    expect(secondsBetween('2026-11-25T19:43:42Z', null)).toBeNull();
  });

  it('finds the rollbacks that left or aimed at a build', () => {
    const rollbacks = [
      { id: 'rb-3', from: { build_id: 'b-3' }, to: { build_id: 'b-2' } },
      { id: 'rb-2', from: { build_id: 'b-2' }, to: { build_id: 'b-1' } },
      { id: 'rb-1', from: { build_id: 'b-9' }, to: { build_id: 'b-8' } },
    ];
    expect(rollbacksOfBuild(rollbacks, 'b-2').map((r) => r.id)).toEqual(['rb-3', 'rb-2']);
    expect(rollbacksOfBuild(rollbacks, 'b-7')).toEqual([]);
  });
});
