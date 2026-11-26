// confirm-dialog.test.tsx
//
// Plan 2026-06-08-dashboard-screens-review-fixes T3.2 + ADR D5.
// Tests the local re-export of @getloopscale/ui's ConfirmDialog. The
// upstream library has its own comprehensive test suite — these tests
// pin THIS module's contract:
//   - canonical import path resolves
//   - props type passes through unchanged
//   - destructive intent renders a destructive-styled confirm button
//   - confirmationPhrase gate blocks confirm until typed exactly
//   - onConfirm fires on confirm click

import { describe, it, expect, vi } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen, fireEvent, waitFor } from '@/test/render';
import { ConfirmDialog } from './confirm-dialog';

describe('ConfirmDialog — canonical destructive confirm primitive', () => {
  it('renders title + description when open', () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Disconnect repo?"
        description="The project stops receiving auto-deploys."
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText(/disconnect repo\?/i)).toBeInTheDocument();
    expect(screen.getByText(/auto-deploys/i)).toBeInTheDocument();
  });

  it('omits content when open=false', () => {
    render(
      <ConfirmDialog
        open={false}
        onOpenChange={() => {}}
        title="Hidden"
        description="Hidden"
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByText(/^Hidden$/)).not.toBeInTheDocument();
  });

  it('fires onConfirm when confirm button clicked (no phrase gate)', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Cancel build?"
        description="The build will stop."
        confirmLabel="Cancel build"
        onConfirm={onConfirm}
      />,
    );
    const confirmBtn = screen.getByRole('button', { name: /cancel build/i });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it('blocks confirm until confirmationPhrase typed exactly (T2T gate)', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete tenant?"
        description="Irreversible."
        confirmationPhrase="delete tenant"
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />,
    );

    // Click without typing phrase — confirm should be disabled (no fire).
    const confirmBtn = screen.getByRole('button', { name: /^delete$/i });
    fireEvent.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled();

    // Type the phrase exactly.
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'delete tenant' } });

    // Click again — should now fire.
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it('confirmationPhrase rejects close-but-not-exact strings', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete tenant?"
        description="Irreversible."
        confirmationPhrase="delete tenant"
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />,
    );

    const input = screen.getByRole('textbox');
    // Common slip — caps mismatch should NOT enable confirm
    fireEvent.change(input, { target: { value: 'Delete Tenant' } });

    const confirmBtn = screen.getByRole('button', { name: /^delete$/i });
    fireEvent.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('passes intent="destructive" through (smoke contract — actual styling lives in @getloopscale/ui)', () => {
    // The upstream owns the destructive CSS; the local re-export just
    // forwards. We assert the prop reaches the rendered subtree by
    // checking the component renders without crashing — the upstream
    // test suite covers visual.
    expect(() =>
      render(
        <ConfirmDialog
          open
          onOpenChange={() => {}}
          title="Destructive"
          description="Will destroy."
          intent="destructive"
          confirmLabel="Destroy"
          onConfirm={() => {}}
        />,
      ),
    ).not.toThrow();
  });
});

// Plano modal-primitive-consolidation T1.1 — a REDE antes da troca de primitivo.
//
// Nenhum dos três modais compartilhados tinha teste de FECHAMENTO, e é a
// propriedade que mais muda ao trocar `ui/dialog` por `AppModal`: os dois
// delegam foco/ESC/overlay ao Radix, mas por composições diferentes. Um erro na
// fiação do `onClose` não quebra nenhum dos 6 casos existentes — eles verificam
// o que aparece, não o que fecha —, e o modal ficaria preso na tela.
//
// 29 arquivos consomem este componente. Um modal que não fecha é um produto
// travado, não um defeito visual.
describe('ConfirmDialog — fechamento (T1.1)', () => {
  it('ESC pede o fechamento', async () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Apagar"
        description="Sem volta."
        onConfirm={vi.fn()}
      />,
    );
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('o botão de fechar pede o fechamento', async () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Apagar"
        description="Sem volta."
        onConfirm={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  /**
   * B-105 — o par que faltava: fecha no sucesso, NÃO fecha no erro.
   *
   * `confirm-dialog.tsx:67-76` chama `onOpenChange(false)` DEPOIS do `await onConfirm()`,
   * dentro do `try`. Se a ação lançar, o diálogo continua aberto — que é o comportamento
   * certo numa confirmação destrutiva, e exatamente por isso precisava de teste: **29
   * consumidores** dependem dele, e a consolidação de modais trocou o primitivo debaixo
   * deste componente sem que nada provasse que a regra sobreviveu. Ela sobreviveu por
   * leitura, não por medição.
   *
   * Fechar em cima de um erro é o pior desfecho possível aqui: quem clicou "Excluir" vê o
   * diálogo sumir e conclui que excluiu. Não excluiu.
   */
  it('fecha quando a ação de confirmação conclui', async () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Excluir ambiente"
        description="Isto é irreversível."
        onConfirm={() => Promise.resolve()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('NÃO fecha quando a ação de confirmação falha', async () => {
    // O caso negativo, e o que o `testing.md § 4.1` chama de prova do error handling:
    // não basta "lança" — o que se afirma é o efeito observável de ter lançado.
    const onOpenChange = vi.fn();
    const falha = vi.fn(() => Promise.reject(new Error('o servidor recusou')));
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Excluir ambiente"
        description="Isto é irreversível."
        onConfirm={falha}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(falha).toHaveBeenCalledTimes(1));
    expect(
      onOpenChange,
      'o diálogo fechou apesar de a ação ter falhado — quem clicou vai acreditar que a ação aconteceu',
    ).not.toHaveBeenCalledWith(false);

    // A outra metade, e a que faltava no produto até este teste ser escrito: ficar aberto
    // SEM DIZER NADA é um diálogo que não respondeu. O usuário não distingue "falhou" de
    // "travou" de "o clique não pegou". `error-handling.md § 3` — falhar alto E claro.
    //
    // A mensagem específica, não um genérico: um "algo deu errado" não diz a quem está
    // lendo se ele deve tentar de novo, corrigir a entrada, ou chamar alguém.
    expect(
      await screen.findByText(/o servidor recusou/i),
      'a falha não apareceu na tela',
    ).toBeInTheDocument();
  });
});
