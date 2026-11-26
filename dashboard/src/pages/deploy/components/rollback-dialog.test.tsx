import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/render';
import type { Build } from '@/lib/api/types';

vi.mock('@usetheo/ui', async (orig) => {
  const actual = await orig<typeof import('@usetheo/ui')>();
  return { ...actual, useToast: () => ({ toast, dismiss }) };
});
vi.mock('@/hooks/deploy/use-rollback-in-flight', () => ({
  useStartRollback: () => startRollback,
  useEndRollback: () => endRollback,
}));
const { toast, dismiss, startRollback, endRollback, mutateAsync } = vi.hoisted(() => ({
  toast: vi.fn(() => 'toast-id'),
  dismiss: vi.fn(),
  startRollback: vi.fn(),
  endRollback: vi.fn(),
  mutateAsync: vi.fn(),
}));
vi.mock('@/hooks/mutations/use-rollback', () => ({
  useRollback: () => ({ mutateAsync, isPending: false, error: null }),
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

function open(environment: string, onRolledBack?: () => void) {
  render(
    <RollbackDialog
      open
      onOpenChange={vi.fn()}
      projectName="demo"
      targetBuild={build(environment)}
      onRolledBack={onRolledBack}
    />,
  );
}

const accepted = {
  status: 'in_progress',
  rolled_back_release: 'rel-current',
  reactivated_release: 'rel-target',
  environment: 'staging',
  url: '',
};

function submit() {
  fireEvent.click(screen.getByRole('checkbox', { name: /confirm rollback/i }));
  fireEvent.click(screen.getByRole('button', { name: /rollback to abcdef1/i }));
}

function toastTitles(): string[] {
  return toast.mock.calls.map((c) => (c as unknown as [{ title: string }])[0].title);
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

  it('o botão do rodapé alcança o `<form>` do corpo e dispara o rollback', () => {
    // Plano `modal-primitive-consolidation`. Os dois casos acima medem a FRICÇÃO
    // (o botão desabilita) e nunca chegam a submeter — então passariam intactos
    // com o rollback quebrado, porque um botão que não faz nada também não faz
    // nada de errado.
    //
    // O `AppModal` renderiza o `footer` FORA dos children. Aqui o `<form>` está no
    // corpo (`:150`) e o submit no rodapé (`:143`); só o `form="rollback-form"` os
    // liga. Se essa associação sumir, a tela renderiza IDÊNTICA, o checkbox
    // continua habilitando o botão, e o clique não reverte nada.
    //
    // O guard estrutural (`modal-primitive.test.ts`) quantifica o atributo sobre
    // todo call site; este caso prova o EFEITO num deles.
    open('staging');
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm rollback/i }));
    fireEvent.click(screen.getByRole('button', { name: /rollback to abcdef1/i }));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('production rollback keeps the stricter type-to-confirm phrase (no ack checkbox)', () => {
    open('production');
    expect(screen.queryByRole('checkbox', { name: /confirm rollback/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rollback to abcdef1/i })).toBeDisabled();
  });

  it('keeps the rollback in progress until the hook reports how it ended', async () => {
    // The API answers 202 and finishes in the background (getloopscale/loop-runtime#118),
    // so the mutation stays pending for as long as the rollback runs.
    let settle: (v: unknown) => void = () => {};
    mutateAsync.mockReturnValue(new Promise((r) => { settle = r; }));
    const onRolledBack = vi.fn();
    open('staging', onRolledBack);
    submit();

    expect(toastTitles()).toEqual(['Rollback in progress']);
    expect(startRollback).toHaveBeenCalledTimes(1);
    expect(endRollback).not.toHaveBeenCalled();
    expect(onRolledBack).not.toHaveBeenCalled();

    settle({ state: 'succeeded', accepted, activeReleaseId: 'rel-target' });
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));

    const done = toast.mock.calls[1] as unknown as [{ title: string; description: string; variant: string }];
    expect(done[0].variant).toBe('success');
    expect(done[0].title).toBe('Rolled back to abcdef1');
    expect(done[0].description).toContain('rel-target');
    expect(dismiss).toHaveBeenCalledWith('toast-id');
    expect(endRollback).toHaveBeenCalledWith('demo');
    expect(onRolledBack).toHaveBeenCalledTimes(1);
  });

  it('says the previous release stays active when the rollback failed in the background', async () => {
    mutateAsync.mockResolvedValue({ state: 'failed', accepted, activeReleaseId: 'rel-current' });
    const onRolledBack = vi.fn();
    open('staging', onRolledBack);
    submit();

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
    const failed = toast.mock.calls[1] as unknown as [{ title: string; description: string; variant: string }];
    expect(failed[0].variant).toBe('destructive');
    expect(failed[0].title).toBe('Rollback failed');
    expect(failed[0].description).toContain('rel-current stays active');
    expect(toastTitles()).not.toContain('Rolled back to abcdef1');
    // The list still refreshes: the in-flight badge has to give way to the real state.
    expect(onRolledBack).toHaveBeenCalledTimes(1);
  });

  it('names the release that took over when another deploy ended the rollback', async () => {
    mutateAsync.mockResolvedValue({ state: 'superseded', accepted, activeReleaseId: 'rel-newer' });
    open('staging');
    submit();

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
    const superseded = toast.mock.calls[1] as unknown as [{ description: string; variant: string }];
    expect(superseded[0].variant).toBe('destructive');
    expect(superseded[0].description).toContain('rel-newer');
  });

  it('does not claim an outcome when the deadline passes', async () => {
    mutateAsync.mockResolvedValue({ state: 'timed_out', accepted, activeReleaseId: null });
    open('staging');
    submit();

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
    const timedOut = toast.mock.calls[1] as unknown as [{ title: string; description: string; variant: string }];
    expect(timedOut[0].variant).toBe('destructive');
    expect(timedOut[0].title).toBe('Rollback not confirmed');
    expect(timedOut[0].description).toContain('16 minutes');
  });
});
