// wiki-search.test.tsx — centered wiki search modal (replaces the lateral command palette).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { userEvent } from '@testing-library/user-event';
import { WikiSearch } from './wiki-search';
import type { WikiEntry } from './wiki-entries';

const pages: WikiEntry[] = [
  { id: 'p1', name: 'api/auth.md', status: 'ready' },
  { id: 'p2', name: 'api/deploy.md', status: 'ready' },
  { id: 'p3', name: 'Overview.md', status: 'ready' },
  { id: 'k1', name: 'runbooks/.keep', status: 'ready' }, // hidden folder marker
];

function open(onSelect = vi.fn()) {
  render(<WikiSearch open onClose={vi.fn()} pages={pages} onSelect={onSelect} />);
  return onSelect;
}

describe('WikiSearch — centered search modal', () => {
  it('renders as a dialog (not a lateral panel) with a search input, hiding .keep markers', () => {
    open();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName(/search wiki/i);
    expect(screen.getByTestId('wiki-search-input')).toBeInTheDocument();
    // .keep marker is not shown
    expect(screen.queryByRole('option', { name: /\.keep/i })).not.toBeInTheDocument();
    // real pages are listed
    expect(screen.getByRole('option', { name: /open api\/auth\.md/i })).toBeInTheDocument();
  });

  it('filters by the full path as you type', async () => {
    open();
    await userEvent.type(screen.getByTestId('wiki-search-input'), 'deploy');
    expect(screen.getByRole('option', { name: /deploy\.md/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /auth\.md/i })).not.toBeInTheDocument();
  });

  it('Enter opens the first result; ArrowDown moves the selection', () => {
    // sorted by path (case-insensitive): api/auth.md (p1), api/deploy.md (p2), Overview.md (p3)
    const onSelect = open();
    const input = screen.getByTestId('wiki-search-input');
    fireEvent.keyDown(input, { key: 'Enter' }); // first result -> p1
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' }); // second result -> p2
    expect(onSelect.mock.calls.map((c) => c[0])).toEqual(['p1', 'p2']);
  });

  it('shows an empty state when nothing matches', async () => {
    open();
    await userEvent.type(screen.getByTestId('wiki-search-input'), 'zzz-nope');
    expect(screen.getByText(/no matching pages/i)).toBeInTheDocument();
  });
});

describe('B-238 — "não achei" e "não consegui ler" não são a mesma frase', () => {
  // Este componente recebe `pages` pronto, e a tela que o monta transformava um erro de leitura em
  // lista vazia (`pagesQuery.data?.items ?? []`). Uma busca durante uma queda de rede respondia
  // "No matching pages" — a afirmação mais confiante possível sobre um acervo que ninguém leu.

  it('com a leitura FALHA, diz que a busca não percorreu o acervo', () => {
    render(<WikiSearch open onClose={vi.fn()} pages={[]} onSelect={vi.fn()} readFailed />);

    expect(screen.getByText(/could not be read/i)).toBeInTheDocument();
    expect(screen.queryByText('No matching pages.')).toBeNull();
  });

  it('sem erro, uma busca vazia continua dizendo que nada casou', () => {
    // A correção não pode virar "sempre avisa que falhou": um acervo vazio de verdade é um fato.
    render(<WikiSearch open onClose={vi.fn()} pages={[]} onSelect={vi.fn()} />);

    expect(screen.getByText('No matching pages.')).toBeInTheDocument();
  });
});
