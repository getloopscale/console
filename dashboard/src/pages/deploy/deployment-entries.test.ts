// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Build, RollbackRecord } from '@/lib/api/types';
import { deploymentEntries } from './deployment-entries';

function build(id: string, at: string, overrides: Partial<Build> = {}): Build {
  return {
    build_id: id,
    project_id: 'app',
    environment: 'production',
    status: 'succeeded',
    commit_sha: `${id}-sha`,
    created_by: 'u-1',
    created_at: at,
    ...overrides,
  };
}

function rollback(id: string, at: string, overrides: Partial<RollbackRecord> = {}): RollbackRecord {
  return {
    id,
    environment: 'production',
    status: 'succeeded',
    from: { release_id: 'rel-b', build_id: 'build-b' },
    to: { release_id: 'rel-a', build_id: 'build-a' },
    created_by: 'u-1',
    created_at: at,
    finished_at: at,
    ...overrides,
  };
}

const all = { status: 'all', env: 'all', moreBuildsOnServer: false } as const;

function keys(entries: ReturnType<typeof deploymentEntries>): string[] {
  return entries.map((e) => (e.kind === 'build' ? e.build.build_id : e.rollback.id));
}

describe('deploymentEntries', () => {
  it('puts each rollback where it happened among the builds, newest first', () => {
    const entries = deploymentEntries(
      [build('build-b', '2026-11-25T19:42:00Z'), build('build-a', '2026-11-25T18:16:00Z')],
      [rollback('rb-2', '2026-11-25T19:43:00Z'), rollback('rb-1', '2026-11-25T19:00:00Z')],
      all,
    );

    expect(keys(entries)).toEqual(['rb-2', 'build-b', 'rb-1', 'build-a']);
  });

  it('orders a build by when it started, as the table shows it', () => {
    const entries = deploymentEntries(
      [build('build-a', '2026-11-25T18:00:00Z', { started_at: '2026-11-25T19:30:00Z' })],
      [rollback('rb-1', '2026-11-25T19:00:00Z')],
      all,
    );

    expect(keys(entries)).toEqual(['build-a', 'rb-1']);
  });

  it('keeps the rollbacks of the environment filtered for', () => {
    const entries = deploymentEntries(
      [],
      [rollback('rb-prod', '2026-11-25T19:00:00Z'), rollback('rb-prev', '2026-11-25T18:00:00Z', { environment: 'preview' })],
      { ...all, env: 'preview' },
    );

    expect(keys(entries)).toEqual(['rb-prev']);
  });

  it('matches a rollback against the status filter by how it ended', () => {
    const rollbacks = [
      rollback('rb-ok', '2026-11-25T19:03:00Z'),
      rollback('rb-failed', '2026-11-25T19:02:00Z', { status: 'failed' }),
      rollback('rb-interrupted', '2026-11-25T19:01:00Z', { status: 'interrupted' }),
      rollback('rb-running', '2026-11-25T19:00:00Z', { status: 'in_progress' }),
    ];

    expect(keys(deploymentEntries([], rollbacks, { ...all, status: 'succeeded' }))).toEqual(['rb-ok']);
    expect(keys(deploymentEntries([], rollbacks, { ...all, status: 'failed' }))).toEqual(['rb-failed', 'rb-interrupted']);
    expect(keys(deploymentEntries([], rollbacks, { ...all, status: 'running' }))).toEqual(['rb-running']);
    expect(keys(deploymentEntries([], rollbacks, { ...all, status: 'cancelled' }))).toEqual([]);
  });

  it('leaves out a rollback older than the last build loaded while the server has more builds', () => {
    const builds = [build('build-b', '2026-11-25T19:42:00Z')];
    const rollbacks = [rollback('rb-new', '2026-11-25T19:43:00Z'), rollback('rb-old', '2026-11-20T10:00:00Z')];

    expect(keys(deploymentEntries(builds, rollbacks, { ...all, moreBuildsOnServer: true }))).toEqual(['rb-new', 'build-b']);
    expect(keys(deploymentEntries(builds, rollbacks, all))).toEqual(['rb-new', 'build-b', 'rb-old']);
  });
});
