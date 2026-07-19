import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import type { Build } from '@/lib/api/types';

vi.mock('@usetheo/ui', async (orig) => {
  const actual = await orig<typeof import('@usetheo/ui')>();
  return { ...actual, useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }) };
});
vi.mock('@/hooks/use-rollback-in-flight', () => ({
  useStartRollback: () => vi.fn(),
  useEndRollback: () => vi.fn(),
}));

import { RollbackDialog } from './rollback-dialog';

function build(environment: string): Build {
  return {
    id: 'b1',
    build_id: 'b1',
    project_id: 'demo',
    commit_sha: 'abcdef1234',
    environment,
    status: 'succeeded',
    created_by: 'u1',
    created_at: '2026-07-19T00:00:00Z',
  } as unknown as Build;
}

function open(environment: string) {
  render(
    <RollbackDialog
      open
      onOpenChange={vi.fn()}
      projectName="demo"
      targetBuild={build(environment)}
    />,
  );
}

describe('RollbackDialog — destructive-action friction (M18)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('non-production rollback is blocked until the user acknowledges (no one-click revert)', () => {
    open('staging');
    const btn = screen.getByRole('button', { name: /rollback to abcdef1/i });
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm rollback/i }));
    expect(btn).not.toBeDisabled();
  });

  it('production rollback keeps the stricter type-to-confirm phrase (no ack checkbox)', () => {
    open('production');
    expect(screen.queryByRole('checkbox', { name: /confirm rollback/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rollback to abcdef1/i })).toBeDisabled();
  });
});
