import { describe, expect, it, vi } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';
import { TeamSwitcher } from './team-switcher';

/**
 * B-135 — o item de menu prometia criar um time e abria documentação.
 *
 * O único chamador de produção (`app-sidebar.tsx:142`) renderiza `<TeamSwitcher fallbackName={…} />`
 * sem `onCreateTeam`, então o ramo de documentação era o único que rodava — sempre. Um item de
 * menu é uma promessa de ação: quem clica em "Create team" espera um time.
 *
 * Este arquivo não existia. O componente tinha `.stories.tsx` — que passa um `onCreateTeam` stub e
 * portanto exercitava só o ramo que produção nunca usa.
 */

describe('TeamSwitcher — o rótulo diz o que a ação faz', () => {
  it('sem um criador de time, o item se anuncia como documentação', async () => {
    render(<TeamSwitcher fallbackName="Ada" />);

    await userEvent.click(screen.getByRole('button'));

    const item = await screen.findByText(/how to create a team/i);
    expect(item).toBeInTheDocument();
    // Asserção sobre o TEXTO renderizado, e não `queryByText(...).toBeNull()`: a catraca de
    // asserções de ausência (B-162) congela aquela forma, e com razão — ela só prova algo quando
    // o elemento existe no caso que passa. Ler o texto é também a afirmação mais forte: a promessa
    // antiga não aparece em lugar nenhum do menu, e não apenas "um seletor não a encontrou".
    expect(item.closest('[role="menu"]')?.textContent ?? '').not.toMatch(/(^|\W)create team(\W|$)/i);
  });

  it('COM um criador de time, ele volta a prometer a ação', async () => {
    // A correção não pode virar "nunca mais oferecer criar um time": quando o endpoint existir e
    // o chamador passar o handler, o rótulo e o ícone voltam.
    render(<TeamSwitcher fallbackName="Ada" onCreateTeam={vi.fn()} />);

    await userEvent.click(screen.getByRole('button'));

    expect(await screen.findByText(/^create team$/i)).toBeInTheDocument();
  });

  it('o criador de time é chamado quando existe, em vez da documentação', async () => {
    const criar = vi.fn();
    render(<TeamSwitcher fallbackName="Ada" onCreateTeam={criar} />);

    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(await screen.findByText(/^create team$/i));

    expect(criar).toHaveBeenCalledOnce();
  });
});
