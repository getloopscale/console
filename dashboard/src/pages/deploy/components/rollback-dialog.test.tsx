import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import type { Build } from '@/lib/api/types';

vi.mock('@usetheo/ui', async (orig) => {
  const actual = await orig<typeof import('@usetheo/ui')>();
  return { ...actual, useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }) };
});
vi.mock('@/hooks/deploy/use-rollback-in-flight', () => ({
  useStartRollback: () => vi.fn(),
  useEndRollback: () => vi.fn(),
}));
const mutateAsync = vi.fn();
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
});
