import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { waitFor } from '@testing-library/react';
import { render, screen, within } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
vi.mock('@/hooks/skills/use-skills', () => ({
  useBundles: () => ({ data: { bundles: [] }, loading: false, error: null }),
  useInvalidateBundles: () => () => {},
}));
const mockCreateBundle = vi.fn();
vi.mock('@/hooks/skills/skills-api', () => ({
  createBundle: (...a: unknown[]) => mockCreateBundle(...a),
  promotionRefusal: (_err: unknown, fallback: string) => fallback,
}));

import { BundlesPage } from './bundles';

describe('BundlesPage (/bundles)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a bundle from the "New bundle" modal', async () => {
    mockCreateBundle.mockResolvedValue({ bundle_id: 'bnd_1', name: 'support skills' });
    render(<BundlesPage />);

    await userEvent.click(screen.getByRole('button', { name: /new bundle/i }));
    const dialog = within(screen.getByRole('dialog', { name: /new bundle/i }));
    await userEvent.type(dialog.getByLabelText(/bundle name/i), 'support skills');
    await userEvent.click(dialog.getByRole('button', { name: /create bundle/i }));

    await waitFor(() => expect(mockCreateBundle).toHaveBeenCalledWith('support skills'));
  });

  it('reports a refused creation inside the modal, which stays open', async () => {
    mockCreateBundle.mockRejectedValue(new Error('name already in use'));
    render(<BundlesPage />);

    await userEvent.click(screen.getByRole('button', { name: /new bundle/i }));
    const dialog = within(screen.getByRole('dialog', { name: /new bundle/i }));
    await userEvent.type(dialog.getByLabelText(/bundle name/i), 'support skills');
    await userEvent.click(dialog.getByRole('button', { name: /create bundle/i }));

    expect(await dialog.findByText(/the bundle was not created/i)).toBeInTheDocument();
  });
});
