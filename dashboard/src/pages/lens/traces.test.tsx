import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensTracesPage } from './traces';

function routeMock() {
  mockCloudFetch.mockImplementation((url: string) => {
    if (url === '/v1/dashboard/lens/traces') return Promise.resolve({ traces: [{ traceId: 'tr_1', name: 'checkout' }] });
    if (url.includes('/tags')) return Promise.resolve({ tags: ['prod'] });
    return Promise.resolve({});
  });
}

describe('LensTracesPage (/observability/traces)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists traces', async () => {
    routeMock();
    render(<LensTracesPage />);
    expect(await screen.findByText('tr_1')).toBeInTheDocument();
  });

  it('adds a tag via POST {tag} after opening a trace', async () => {
    routeMock();
    render(<LensTracesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /open tr_1/i }));
    await userEvent.type(await screen.findByLabelText(/new tag/i), 'canary');
    await userEvent.click(screen.getByRole('button', { name: /add tag/i }));
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/lens/traces/tr_1/tags',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ tag: 'canary' }) }),
    );
  });

  it('remove-tag opens ConfirmDialog then calls DELETE ?tag= on confirm', async () => {
    routeMock();
    render(<LensTracesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /open tr_1/i }));
    await userEvent.click(await screen.findByRole('button', { name: /remove tag prod/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^remove tag$/i }));
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/lens/traces/tr_1/tags?tag=prod',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
