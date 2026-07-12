import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { RagConnectorsPage } from './connectors';

const ONE = { items: [{ id: 'conn_1', provider_id: 's3', collection_id: 'col_1', status: 'active' }] };

describe('RagConnectorsPage (/rag/connectors)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists connections and syncs one via POST', async () => {
    mockCloudFetch.mockResolvedValue(ONE);
    render(<RagConnectorsPage />);
    expect(await screen.findByText('s3')).toBeInTheDocument();
    expect(screen.getByText('col_1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /sync conn_1/i }));
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/rag/connectors/conn_1/sync',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('renders the empty state (CLI/API note) when there are no connectors', async () => {
    mockCloudFetch.mockResolvedValue({ items: [] });
    render(<RagConnectorsPage />);
    expect(await screen.findByText(/no connectors yet/i)).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});

describe('RagConnectorsPage — destructive delete flow', () => {
  beforeEach(() => vi.clearAllMocks());
  it('delete opens ConfirmDialog then calls DELETE on confirm', async () => {
    mockCloudFetch.mockResolvedValue(ONE);
    render(<RagConnectorsPage />);
    await screen.findByText('s3');
    await userEvent.click(screen.getByRole('button', { name: /delete conn_1/i }));
    const confirm = await screen.findByRole('button', { name: /delete connector/i });
    await userEvent.click(confirm);
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/rag/connectors/conn_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('surfaces an error (not a silent hang) when delete fails with 409 while syncing', async () => {
    // list ok, then the DELETE rejects (theo-rag returns 409 connection_syncing)
    mockCloudFetch.mockResolvedValueOnce(ONE).mockRejectedValueOnce(new Error('409 connection_syncing'));
    render(<RagConnectorsPage />);
    await screen.findByText('s3');
    await userEvent.click(screen.getByRole('button', { name: /delete conn_1/i }));
    await userEvent.click(await screen.findByRole('button', { name: /delete connector/i }));
    expect(await screen.findByText(/could not delete the connector/i)).toBeInTheDocument();
  });
});
