import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensDatasetsPage } from './datasets';

describe('LensDatasetsPage (/observability/datasets)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists datasets and creates one via POST {name}', async () => {
    mockCloudFetch.mockResolvedValue({ datasets: [{ id: 'ds_1', name: 'golden', itemCount: 2 }] });
    render(<LensDatasetsPage />);
    expect(await screen.findByText('golden')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/dataset name/i), 'reports');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/lens/datasets',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'reports' }) }),
    );
  });

  it('M70 — a dataset row jumps to the Experiments run form seeded with the dataset (eval loop)', async () => {
    mockCloudFetch.mockResolvedValue({ datasets: [{ id: 'ds_1', name: 'golden', itemCount: 2 }] });
    render(<LensDatasetsPage />);
    const link = await screen.findByRole('link', { name: /run experiment/i });
    expect(link).toHaveAttribute('href', '/observability/experiments?datasetId=ds_1');
  });

  it('renders empty state when there are no datasets', async () => {
    mockCloudFetch.mockResolvedValue({ datasets: [] });
    render(<LensDatasetsPage />);
    expect(await screen.findByText(/no datasets yet/i)).toBeInTheDocument();
  });

  it('a failed items-detail load shows an Alert, NOT "No items" (#error-as-empty)', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url === '/v1/dashboard/lens/datasets') return Promise.resolve({ datasets: [{ id: 'ds_1', name: 'golden', itemCount: 3 }] });
      if (url.startsWith('/v1/dashboard/lens/datasets/ds_1')) return Promise.reject(Object.assign(new Error('boom'), { status: 500 }));
      return Promise.resolve({});
    });
    render(<LensDatasetsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /open golden/i }));
    expect(await screen.findByText(/could not load items/i)).toBeInTheDocument();
    expect(screen.queryByText(/no items/i)).not.toBeInTheDocument(); // error must NOT read as empty
  });

  it('an absent item count renders em-dash, a real 0 renders 0 (no fabricated count)', async () => {
    mockCloudFetch.mockResolvedValue({
      datasets: [
        { id: 'ds_1', name: 'unknown-count' }, // itemCount absent → em-dash
        { id: 'ds_2', name: 'empty-loaded', itemCount: 0 }, // real 0 → 0
      ],
    });
    render(<LensDatasetsPage />);
    expect(await screen.findByText('unknown-count')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1); // absent count → em-dash
    expect(screen.getByText('0')).toBeInTheDocument(); // honest zero (loaded-but-empty dataset)
  });

  it('remove-item opens ConfirmDialog then calls DELETE on confirm', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url === '/v1/dashboard/lens/datasets') return Promise.resolve({ datasets: [{ id: 'ds_1', name: 'golden', itemCount: 1 }] });
      if (url.startsWith('/v1/dashboard/lens/datasets/ds_1')) return Promise.resolve({ id: 'ds_1', name: 'golden', items: [{ traceId: 'tr_9' }] });
      return Promise.resolve({});
    });
    render(<LensDatasetsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /open golden/i }));
    await userEvent.click(await screen.findByRole('button', { name: /remove tr_9/i }));
    const confirm = await screen.findByRole('button', { name: /remove item/i });
    await userEvent.click(confirm);
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/lens/datasets/ds_1/items/tr_9',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
