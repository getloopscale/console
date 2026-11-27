import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { Plus } from 'lucide-react';
import { PageShell } from './page-shell';

/** The page frame. Its text is the header plus the body or the state that stands in for it. */
const shell = () => document.querySelector('[data-slot="page-shell"]') as HTMLElement;

describe('PageShell', () => {
  it('puts the title and the main action on one header line', async () => {
    const onClick = vi.fn();
    render(
      <PageShell title="Domains" description="Hosts of this project" primaryAction={{ label: 'Add domain', icon: Plus, onClick }}>
        <p>body</p>
      </PageShell>,
    );
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('heading', { level: 1, name: 'Domains' })).toBeInTheDocument();
    expect(within(header).getByText('Hosts of this project')).toBeInTheDocument();
    const action = within(header).getByRole('button', { name: 'Add domain' });
    await userEvent.click(action);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(shell()).toHaveTextContent('body');
  });

  it('paints the main action neutral: the brand color does not fill a button', () => {
    render(<PageShell title="Domains" primaryAction={{ label: 'Add domain', onClick: () => {} }} />);
    const action = screen.getByRole('button', { name: 'Add domain' });
    expect(action.className).toMatch(/bg-foreground/);
    expect(action.className).not.toMatch(/bg-(accent|primary)(\s|$)/);
  });

  it('disables the main action while it is loading', () => {
    render(<PageShell title="Lens" primaryAction={{ label: 'Refresh', onClick: () => {}, loading: true }} />);
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeDisabled();
  });

  it('keeps the search field of the page', async () => {
    const onChange = vi.fn();
    render(<PageShell title="Projects" search={{ placeholder: 'Search projects...', value: '', onChange }} />);
    await userEvent.type(screen.getByPlaceholderText('Search projects...'), 'a');
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('shows loading in place of the children and marks the page busy', () => {
    render(
      <PageShell title="Projects" loading>
        <p>body</p>
      </PageShell>,
    );
    expect(shell()).not.toHaveTextContent('body');
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 }).closest('[data-slot="page-shell"]')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the error with a retry in place of the children', async () => {
    const onRetry = vi.fn();
    render(
      <PageShell title="Projects" error={{ message: 'Could not load projects', onRetry }}>
        <p>body</p>
      </PageShell>,
    );
    expect(shell()).not.toHaveTextContent('body');
    expect(screen.getByText('Could not load projects')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state with its action in place of the children', async () => {
    const onClick = vi.fn();
    render(
      <PageShell title="Secrets" empty={{ title: 'No secrets yet', description: 'Add the first one', action: { label: 'Add secret', onClick } }}>
        <p>body</p>
      </PageShell>,
    );
    expect(shell()).not.toHaveTextContent('body');
    expect(screen.getByText('No secrets yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add secret' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('reports the title to the layout', () => {
    const onTitleChange = vi.fn();
    render(<PageShell title="Billing" onTitleChange={onTitleChange} />);
    expect(onTitleChange).toHaveBeenCalledWith('Billing');
  });
});
