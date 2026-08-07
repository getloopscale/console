import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({
  cloudFetch: (...a: unknown[]) => mockCloudFetch(...a),
  getApiBase: () => 'https://cloud-test',
}));

import { RagConnectorsPage } from './connectors';

const ONE = { items: [{ id: 'conn_1', provider_id: 's3', collection_id: 'col_1', status: 'active' }] };

describe('RagConnectorsPage (/rag/connectors)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists connections and syncs one via POST', async () => {
    mockCloudFetch.mockResolvedValue(ONE);
    render(<RagConnectorsPage />);
    expect(await screen.findByText('S3')).toBeInTheDocument();
    expect(screen.getByText('col_1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /sync conn_1/i }));
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/rag/connectors/conn_1/sync',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('renders the empty state (in-UI paste-credential note) when there are no connectors', async () => {
    mockCloudFetch.mockResolvedValue({ items: [] });
    render(<RagConnectorsPage />);
    expect(await screen.findByText(/no connectors yet/i)).toBeInTheDocument();
    expect(screen.getByText(/paste-credential source/i)).toBeInTheDocument();
  });

  it('M12 — connects an S3 paste-credential source with the entered fields', async () => {
    mockCloudFetch.mockImplementation((path: string) => {
      if (path === '/v1/dashboard/rag/collections') return Promise.resolve({ items: [{ id: 'col_1', name: 'docs' }] });
      if (path === '/v1/dashboard/rag/connectors/providers') return Promise.resolve({ providers: [] });
      if (path.endsWith('/connect')) return Promise.resolve({ id: 'conn_new' });
      return Promise.resolve({ items: [] });
    });
    render(<RagConnectorsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /connect a source/i }));
    // pick a collection (first combobox = Collection)
    await userEvent.click(await screen.findByRole('combobox', { name: 'Collection' }));
    await userEvent.click(await screen.findByRole('option', { name: 'docs' }));
    // pick the S3 credential provider
    await userEvent.click(screen.getByRole('combobox', { name: 'Credential provider' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Amazon S3' }));
    // fill the required S3 fields
    await userEvent.type(screen.getByLabelText('Access key ID'), 'AKIATEST');
    await userEvent.type(screen.getByLabelText('Secret access key'), 'sekret');
    await userEvent.type(screen.getByLabelText('Region'), 'us-east-1');
    await userEvent.type(screen.getByLabelText('Bucket'), 'my-bucket');
    await userEvent.click(screen.getByRole('button', { name: /connect amazon s3/i }));

    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/rag/connectors/s3/connect',
      expect.objectContaining({ method: 'POST' }),
    );
    const call = mockCloudFetch.mock.calls.find((c) => c[0] === '/v1/dashboard/rag/connectors/s3/connect');
    const body = JSON.parse((call?.[1] as { body: string }).body);
    expect(body).toMatchObject({
      collection_id: 'col_1',
      access_key_id: 'AKIATEST',
      secret_access_key: 'sekret',
      region: 'us-east-1',
      bucket: 'my-bucket',
    });
  });
});

describe('RagConnectorsPage — destructive delete flow', () => {
  beforeEach(() => vi.clearAllMocks());
  it('delete opens ConfirmDialog then calls DELETE on confirm', async () => {
    mockCloudFetch.mockResolvedValue(ONE);
    render(<RagConnectorsPage />);
    await screen.findByText('S3');
    await userEvent.click(screen.getByRole('button', { name: /delete conn_1/i }));
    const confirm = await screen.findByRole('button', { name: /delete connector/i });
    await userEvent.click(confirm);
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/rag/connectors/conn_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('surfaces an error (not a silent hang) when delete fails with 409 while syncing', async () => {
    // list ok, then the DELETE rejects (theo-rag returns 409 connection_syncing). Path/method-aware
    // so it is robust to the extra providers/collections queries the M8 connect flow now fires.
    mockCloudFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === 'DELETE') return Promise.reject(new Error('409 connection_syncing'));
      if (path === '/v1/dashboard/rag/connectors') return Promise.resolve(ONE);
      return Promise.resolve({ items: [] });
    });
    render(<RagConnectorsPage />);
    await screen.findByText('S3');
    await userEvent.click(screen.getByRole('button', { name: /delete conn_1/i }));
    await userEvent.click(await screen.findByRole('button', { name: /delete connector/i }));
    expect(await screen.findByText(/could not delete the connector/i)).toBeInTheDocument();
  });
});

// M8 — connect a NEW OAuth source from the dashboard via the broker ("Connect with X").
describe('RagConnectorsPage — M8 OAuth "Connect a source"', () => {
  beforeEach(() => vi.clearAllMocks());

  // Path-aware mock: connectors list empty, two configured OAuth providers, one collection.
  const wireOAuth = () =>
    mockCloudFetch.mockImplementation((path: string) => {
      if (path === '/v1/dashboard/rag/connectors/providers') return Promise.resolve({ providers: ['dropbox', 'google-drive'] });
      if (path === '/v1/dashboard/rag/collections') return Promise.resolve({ items: [{ id: 'col_1', name: 'Docs' }] });
      return Promise.resolve({ items: [] }); // connectors list
    });

  it('offers only the operator-configured OAuth providers (disabled until a collection is picked)', async () => {
    wireOAuth();
    render(<RagConnectorsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /connect a source/i }));
    // both configured providers are offered, and disabled before a collection is chosen
    const gd = await screen.findByRole('button', { name: /connect with google drive/i });
    expect(gd).toBeDisabled();
    expect(screen.getByRole('button', { name: /connect with dropbox/i })).toBeDisabled();
    // a provider NOT configured (e.g. salesforce) is never offered
    expect(screen.queryByRole('button', { name: /connect with salesforce/i })).toBeNull();
  });

  it('"Connect with X" is a top-level link to the BFF authorize endpoint with the chosen collection', async () => {
    wireOAuth();
    render(<RagConnectorsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /connect a source/i }));
    // pick the collection (Radix Select — open + choose)
    await userEvent.click(await screen.findByRole('combobox', { name: 'Collection' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Docs' }));
    // now the provider becomes a real anchor to the OAuth broker on the BFF origin
    const link = await screen.findByRole('link', { name: /connect with google drive/i });
    expect(link).toHaveAttribute(
      'href',
      'https://cloud-test/v1/rag-connect/google-drive/authorize?collection_id=col_1',
    );
  });

  it('shows a success banner when the broker redirects back with ?connected=', async () => {
    wireOAuth();
    const before = window.location.pathname + window.location.search;
    window.history.replaceState({}, '', '/rag/connectors?connected=dropbox');
    try {
      render(<RagConnectorsPage />);
      expect(await screen.findByText(/connected dropbox/i)).toBeInTheDocument();
    } finally {
      window.history.replaceState({}, '', before);
    }
  });

  it('shows a typed error banner when the broker redirects back with ?connect_error=', async () => {
    wireOAuth();
    const before = window.location.pathname + window.location.search;
    window.history.replaceState({}, '', '/rag/connectors?connect_error=provider_exchange_failed');
    try {
      render(<RagConnectorsPage />);
      expect(await screen.findByText(/could not connect the source/i)).toBeInTheDocument();
      expect(screen.getByText(/provider rejected the connection/i)).toBeInTheDocument();
    } finally {
      window.history.replaceState({}, '', before);
    }
  });
});
