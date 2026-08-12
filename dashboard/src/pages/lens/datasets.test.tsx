import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensDatasetsPage } from './datasets';

describe('LensDatasetsPage (/observability/datasets)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists datasets and creates one via POST {name}', async () => {
    mockCloudFetch.mockResolvedValue({ datasets: [{ id: 'ds_1', name: 'golden', itemCount: 2 }] });
    render(<LensDatasetsPage />);
    expect(await screen.findByText('golden')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /new dataset/i })); // open the centered create modal
    await userEvent.type(screen.getByLabelText(/dataset name/i), 'reports');
    await userEvent.click(screen.getByRole('button', { name: /create dataset/i }));
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/lens/datasets',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'reports' }) }),
      // B-244/B-235 — o terceiro argumento é o contrato de erro. Sem ele uma recusa RESOLVIA
      // `null`, o `onSuccess` disparava, o diálogo fechava e o campo era limpo: o usuário saía
      // acreditando ter criado um dataset que não existe.
      { throwOnError: true },
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

  it('M73 — the empty state CTA opens the create modal with the name field focused (one clear action)', async () => {
    mockCloudFetch.mockResolvedValue({ datasets: [] });
    render(<LensDatasetsPage />);
    await screen.findByText(/no datasets yet/i);
    // The create form now lives in a centered modal; the CTA opens it (autoFocus lands on the name field).
    await userEvent.click(screen.getByRole('button', { name: /name your first dataset/i }));
    expect(screen.getByLabelText(/dataset name/i)).toHaveFocus();
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

  it('M70 — the open dataset panel is URL-state (?dataset=) — deep-linkable + Back-closable', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url === '/v1/dashboard/lens/datasets') return Promise.resolve({ datasets: [{ id: 'ds_1', name: 'golden', itemCount: 1 }] });
      if (url.startsWith('/v1/dashboard/lens/datasets/ds_1')) return Promise.resolve({ id: 'ds_1', name: 'golden', items: [{ traceId: 'tr_9' }] });
      return Promise.resolve({});
    });
    // deep-link straight to an open dataset via the URL param — the items panel loads without a click
    render(<LensDatasetsPage />, { initialEntries: ['/observability/datasets?dataset=ds_1'] });
    expect(await screen.findByText('tr_9')).toBeInTheDocument(); // the ds_1 items panel is open from the URL
  });

  it('M70 — a dataset item opens its source-trace span peek (no dead-end)', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url === '/v1/dashboard/lens/datasets') return Promise.resolve({ datasets: [{ id: 'ds_1', name: 'golden', itemCount: 1 }] });
      if (url.startsWith('/v1/dashboard/lens/datasets/ds_1')) return Promise.resolve({ id: 'ds_1', name: 'golden', items: [{ traceId: 'tr_9' }] });
      // the peek fetches the trace tree
      if (/\/traces\/tr_9/.test(url)) return Promise.resolve({ traceId: 'tr_9', spanId: 's', name: 'root', children: [] });
      return Promise.resolve({});
    });
    render(<LensDatasetsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /open golden/i }));
    await userEvent.click(await screen.findByRole('button', { name: /view trace/i }));
    // the peek requested the source trace
    expect(mockCloudFetch.mock.calls.some((c) => /\/traces\/tr_9/.test(String(c[0])))).toBe(true);
  });

  it('M82 — rename a dataset inline via PUT {name}', async () => {
    mockCloudFetch.mockResolvedValue({ datasets: [{ id: 'ds_1', name: 'golden', itemCount: 2 }] });
    render(<LensDatasetsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /rename golden/i }));
    const input = await screen.findByLabelText(/rename dataset golden/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'renamed{Enter}');
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/lens/datasets/ds_1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ name: 'renamed' }) }),
      expect.anything(),
    );
  });

  it('M82 — delete a dataset opens ConfirmDialog then calls DELETE on confirm', async () => {
    mockCloudFetch.mockResolvedValue({ datasets: [{ id: 'ds_1', name: 'golden', itemCount: 2 }] });
    render(<LensDatasetsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /delete dataset golden/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^delete dataset$/i }));
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/lens/datasets/ds_1',
      expect.objectContaining({ method: 'DELETE' }),
      expect.anything(),
    );
  });

  it('M82 — a rename to a duplicate name (409) shows a name-conflict message, not a generic error', async () => {
    mockCloudFetch.mockImplementation((_url: string, opts?: { method?: string }) => {
      if (opts?.method === 'PUT') return Promise.reject(Object.assign(new Error('conflict'), { status: 409 }));
      return Promise.resolve({ datasets: [{ id: 'ds_1', name: 'golden', itemCount: 2 }] });
    });
    render(<LensDatasetsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /rename golden/i }));
    const input = await screen.findByLabelText(/rename dataset golden/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'taken{Enter}');
    expect(await screen.findByText(/already (exists|in use|taken)|name.*already/i)).toBeInTheDocument();
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
      // Mesma falta, efeito oposto: a linha sumia da tela e voltava na leitura seguinte.
      { throwOnError: true },
    );
  });
});
