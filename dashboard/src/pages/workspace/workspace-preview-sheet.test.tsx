import { describe, it, expect, vi } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen, within } from '@/test/render';

import { WorkspacePreviewSheet } from './workspace-preview-sheet';

const FILE = { path: 'reports/q3.json', size: 2048, content_type: 'application/json' };

function renderPreview(over: Partial<Parameters<typeof WorkspacePreviewSheet>[0]> = {}) {
  const handlers = { onClose: vi.fn(), onDownload: vi.fn(), onShare: vi.fn(), onDelete: vi.fn() };
  render(
    <WorkspacePreviewSheet
      preview={FILE}
      prefix="reports/"
      query={{ isLoading: false, isError: false, data: { kind: 'text', text: '{"ok":true}' } }}
      shareUrl={null}
      {...handlers}
      {...over}
    />,
  );
  return handlers;
}

describe('WorkspacePreviewSheet', () => {
  it('previews the file in a modal, with the actions in its footer', async () => {
    const handlers = renderPreview();

    const dialog = within(screen.getByRole('dialog', { name: /q3\.json/ }));
    expect(dialog.getByText('reports/q3.json')).toBeInTheDocument();

    await userEvent.click(dialog.getByRole('button', { name: /download/i }));
    expect(handlers.onDownload).toHaveBeenCalledWith(FILE);
    await userEvent.click(dialog.getByRole('button', { name: /share link/i }));
    expect(handlers.onShare).toHaveBeenCalledWith('reports/q3.json');
    await userEvent.click(dialog.getByRole('button', { name: /delete/i }));
    expect(handlers.onDelete).toHaveBeenCalledWith(FILE);
  });

  it('shows the share link once one was issued', () => {
    renderPreview({ shareUrl: 'https://files.example/s/abc' });
    expect(screen.getByTestId('share-link')).toHaveTextContent('https://files.example/s/abc');
  });

  it('says a read failed, where an empty preview would pass for an empty file', () => {
    renderPreview({ query: { isLoading: false, isError: true } });
    expect(screen.getByText('Could not load this file.')).toBeInTheDocument();
  });
});
