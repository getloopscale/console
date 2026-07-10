import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, violetForge } from '@usetheo/ui';

import { ColumnsToggle } from './columns-toggle';
import type { ColumnState } from './view-encoding';

const state: ColumnState = { visibility: {}, density: 'comfortable' } as ColumnState;

function renderToggle() {
  return render(<ColumnsToggle state={state} onChange={vi.fn()} />, {
    wrapper: ({ children }) => (
      <ThemeProvider themes={[violetForge]} defaultTheme="violet-forge" defaultMode="dark">
        <button type="button">outside</button>
        {children}
      </ThemeProvider>
    ),
  });
}

describe('ColumnsToggle a11y (M98 D-M5)', () => {
  it('Escape closes the panel and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderToggle();
    const trigger = screen.getByRole('button', { name: /choose columns/i });
    await user.click(trigger);
    expect(await screen.findByTestId('columns-panel')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('columns-panel')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('an outside click closes the panel', async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole('button', { name: /choose columns/i }));
    expect(await screen.findByTestId('columns-panel')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'outside' }));
    await waitFor(() => expect(screen.queryByTestId('columns-panel')).toBeNull());
  });

  it('the trigger wires aria-controls + aria-expanded for assistive tech', async () => {
    const user = userEvent.setup();
    renderToggle();
    const trigger = screen.getByRole('button', { name: /choose columns/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-controls', 'columns-panel');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});
