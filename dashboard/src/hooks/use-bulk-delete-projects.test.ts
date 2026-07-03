import { describe, it, expect, vi } from 'vitest';

import { bulkDeleteProjects } from './use-bulk-delete-projects';

// J-07 D4 — the bulk-delete core is best-effort: one failure never aborts the
// rest, and the result honestly reports which succeeded vs failed.
describe('bulkDeleteProjects (J-07 D4)', () => {
  it('test_all_succeed', async () => {
    const deleteOne = vi.fn().mockResolvedValue(undefined);
    const r = await bulkDeleteProjects(['a', 'b', 'c'], deleteOne);
    expect(r.succeeded).toEqual(['a', 'b', 'c']);
    expect(r.failed).toEqual([]);
    expect(deleteOne).toHaveBeenCalledTimes(3);
  });

  it('test_partial_failure_does_not_abort_the_rest', async () => {
    // 'b' fails; 'a' and 'c' MUST still be attempted + succeed.
    const deleteOne = vi.fn(async (name: string) => {
      if (name === 'b') throw new Error('PROJECT_HAS_ACTIVE_DEPLOY');
    });
    const r = await bulkDeleteProjects(['a', 'b', 'c'], deleteOne);
    expect(r.succeeded).toEqual(['a', 'c']);
    expect(r.failed).toEqual([{ name: 'b', error: 'PROJECT_HAS_ACTIVE_DEPLOY' }]);
    expect(deleteOne).toHaveBeenCalledTimes(3); // never short-circuits
  });

  it('test_all_fail', async () => {
    const deleteOne = vi.fn().mockRejectedValue(new Error('boom'));
    const r = await bulkDeleteProjects(['x', 'y'], deleteOne);
    expect(r.succeeded).toEqual([]);
    expect(r.failed.map((f) => f.name)).toEqual(['x', 'y']);
    expect(r.failed.every((f) => f.error === 'boom')).toBe(true);
  });

  it('test_empty_list_is_a_noop', async () => {
    const deleteOne = vi.fn();
    const r = await bulkDeleteProjects([], deleteOne);
    expect(r).toEqual({ succeeded: [], failed: [] });
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it('test_non_error_rejection_is_stringified', async () => {
    const deleteOne = vi.fn().mockRejectedValue('raw-string-reason');
    const r = await bulkDeleteProjects(['z'], deleteOne);
    expect(r.failed).toEqual([{ name: 'z', error: 'raw-string-reason' }]);
  });

  it('test_preserves_order', async () => {
    const order: string[] = [];
    const deleteOne = vi.fn(async (name: string) => {
      order.push(name);
    });
    await bulkDeleteProjects(['3', '1', '2'], deleteOne);
    expect(order).toEqual(['3', '1', '2']); // sequential, input order preserved
  });
});
