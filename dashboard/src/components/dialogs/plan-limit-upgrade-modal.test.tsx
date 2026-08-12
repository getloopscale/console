import { act, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { PlanLimitUpgradeModal } from './plan-limit-upgrade-modal';

function withRouter(node: React.ReactNode) {
  return <BrowserRouter>{node}</BrowserRouter>;
}

describe('PlanLimitUpgradeModal', () => {
  it('test_closed_by_default', () => {
    render(withRouter(<PlanLimitUpgradeModal />));
    expect(screen.queryByText(/Plan limit reached/i)).not.toBeInTheDocument();
  });

  it('test_opens_on_plan_limit_event', async () => {
    render(withRouter(<PlanLimitUpgradeModal />));

    act(() => {
      window.dispatchEvent(
        new CustomEvent('theo:plan-limit', {
          detail: {
            code: 'PLAN_LIMIT_EXCEEDED',
            message: 'You hit the env cap',
            resource: 'environments',
          },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/Plan limit reached/i)).toBeInTheDocument();
    });
    expect(screen.getByText('You hit the env cap')).toBeInTheDocument();
  });

  it('test_upgrade_link_targets_billing', async () => {
    render(withRouter(<PlanLimitUpgradeModal />));

    act(() => {
      window.dispatchEvent(new CustomEvent('theo:plan-limit', { detail: null }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Plan limit reached/i)).toBeInTheDocument();
    });

    const upgradeLink = screen.getByRole('link', { name: /Upgrade plan/i });
    expect(upgradeLink).toHaveAttribute('href', '/billing');
  });

  it('test_renders_fallback_when_detail_null', async () => {
    render(withRouter(<PlanLimitUpgradeModal />));

    act(() => {
      window.dispatchEvent(new CustomEvent('theo:plan-limit', { detail: null }));
    });

    await waitFor(() => {
      // Fallback message uses "this resource" placeholder + Free plan default
      expect(screen.getByText(/this resource/i)).toBeInTheDocument();
    });
  });
});

// Plano modal-primitive-consolidation T1.1 — este fecha por estado INTERNO
// (`setOpen`), então o observável não é um callback: é o modal sumir da tela.
// Sem este caso, uma troca de primitivo que perdesse a fiação do fechamento
// deixaria o aviso de limite de plano preso sobre a interface, e nenhum dos 4
// casos existentes acusaria — eles verificam o que aparece.
describe('PlanLimitUpgradeModal — fechamento (T1.1)', () => {
  it('ESC tira o modal da tela', async () => {
    render(
      <BrowserRouter>
        <PlanLimitUpgradeModal />
      </BrowserRouter>,
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent('theo:plan-limit', { detail: { message: 'Limite atingido' } }),
      );
    });
    await screen.findByText('Limite atingido');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Limite atingido')).toBeNull());
  });
});
