import { describe, it, expect, vi } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen, within } from '@/test/render';
import type { APIKeyView } from '@/hooks/settings/api-keys-api';

vi.mock('@/hooks/settings/use-api-keys', () => ({
  useApiKeyLineage: () => ({
    isLoading: false,
    isError: false,
    data: {
      lineage: [
        { id: 'key_root', name: 'ci', key_prefix: 'ls_aaaa', created_at: '2026-10-01T10:00:00Z', is_current: false },
        { id: 'key_now', name: 'ci', key_prefix: 'ls_bbbb', created_at: '2026-11-01T10:00:00Z', is_current: true },
      ],
    },
  }),
}));

import { LineageSheet } from './api-key-lineage';

const TARGET = { id: 'key_now', name: 'ci' } as APIKeyView;

describe('LineageSheet', () => {
  it('shows the rotation chain in a modal named after its title', () => {
    render(<LineageSheet target={TARGET} onClose={() => {}} />);

    const dialog = within(screen.getByRole('dialog', { name: 'Rotation history' }));
    expect(dialog.getByText(/Lineage of "ci"/)).toBeInTheDocument();
    expect(dialog.getByTestId('lineage-row-key_root')).toBeInTheDocument();
    expect(dialog.getByTestId('lineage-current-key_now')).toHaveTextContent('Current');
  });

  it('closes from the close button of the modal', async () => {
    const onClose = vi.fn();
    render(<LineageSheet target={TARGET} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
