import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { RagCollectionsPage } from './collections';

describe('RagCollectionsPage (/rag/collections)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists collections and creates one via POST', async () => {
    mockCloudFetch.mockResolvedValue({ items: [{ id: 'col_1', name: 'docs' }] });
    render(<RagCollectionsPage />);
    expect(await screen.findByText('docs')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/new collection name/i), 'reports');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/rag/collections',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('renders empty state when there are no collections', async () => {
    mockCloudFetch.mockResolvedValue({ items: [] });
    render(<RagCollectionsPage />);
    expect(await screen.findByText(/no collections yet/i)).toBeInTheDocument();
  });
});

import { userEvent as ue2 } from '@testing-library/user-event';

describe('RagCollectionsPage — destructive delete flow', () => {
  beforeEach(() => vi.clearAllMocks());
  it('delete opens ConfirmDialog then calls DELETE on confirm', async () => {
    mockCloudFetch.mockResolvedValue({ items: [{ id: 'col_1', name: 'docs' }] });
    render(<RagCollectionsPage />);
    await screen.findByText('docs');
    await ue2.click(screen.getByRole('button', { name: /delete col_1/i }));
    // ConfirmDialog visible
    const confirm = await screen.findByRole('button', { name: /delete collection/i });
    await ue2.click(confirm);
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/rag/collections/col_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
