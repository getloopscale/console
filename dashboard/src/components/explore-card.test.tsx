import { describe, it, expect } from 'vitest';
import { Brain } from 'lucide-react';
import { render, screen } from '@/test/render';
import { ExploreCard } from './explore-card';

describe('ExploreCard', () => {
  it('a ação é um link de rota, e não um botão que recarrega a página', () => {
    // B-192 — a divergência que a triplicação produziu: uma cópia foi corrigida para `<Link>`
    // enquanto as outras duas seguiram atribuindo `window.location.href`, o que recarrega o app
    // inteiro e descarta o cache do TanStack Query. Uma âncora com `href` é a diferença
    // observável entre navegar dentro da SPA e sair dela.
    render(<ExploreCard icon={Brain} title="Sessions" description="Todas as sessões" href="/lens/sessions" />);

    const acao = screen.getByRole('link', { name: /open/i });
    expect(acao).toHaveAttribute('href', '/lens/sessions');
  });

  it('mostra título e descrição', () => {
    render(<ExploreCard icon={Brain} title="Sessions" description="Todas as sessões" href="/x" />);
    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument();
    expect(screen.getByText('Todas as sessões')).toBeInTheDocument();
  });

  it('o ícone é decorativo — quem usa leitor de tela não o ouve duas vezes', () => {
    // O título ao lado já diz o que o cartão é; anunciar o ícone repetiria a informação.
    const { container } = render(
      <ExploreCard icon={Brain} title="Sessions" description="d" href="/x" />,
    );
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
