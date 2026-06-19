// Plan theo-memory-dashboard-full-integration, T3.1.
// Covers the Playground page: remember submits + shows success, recall renders
// scored results, reflect shows the passed-through result. All three verbs go
// through the dashboard BFF (`/v1/dashboard/memory/{remember,recall,reflect}`).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen, waitFor } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
  getApiBase: () => '',
}));

import { PlaygroundPage } from './playground';

beforeEach(() => {
  mockCloudFetch.mockReset();
});

describe('Memory Playground (T3.1)', () => {
  it('uses the standard PageShell + space-y-6 layout (no ad-hoc padding)', () => {
    const { container } = render(<PlaygroundPage />, { initialEntries: ['/memory/playground'] });
    expect(container.querySelector('.space-y-6')).not.toBeNull();
  });

  it('remember posts to the BFF and shows the stored item', async () => {
    mockCloudFetch.mockResolvedValueOnce({ items: [{ id: 'mem-123456789012', content: 'oat milk' }] });
    render(<PlaygroundPage />, { initialEntries: ['/memory/playground'] });

    await userEvent.type(
      screen.getByLabelText('Memory text to remember'),
      'Paulo likes oat milk',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remember' }));

    await waitFor(() => {
      expect(mockCloudFetch).toHaveBeenCalledWith(
        '/v1/dashboard/memory/remember',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText(/Stored 1 memory/i)).toBeInTheDocument();
  });

  it('recall posts to the BFF and renders scored results', async () => {
    mockCloudFetch.mockResolvedValueOnce({
      results: [{ id: 'mem-abc', content: 'oat milk', score: 0.912 }],
    });
    render(<PlaygroundPage />, { initialEntries: ['/memory/playground'] });

    await userEvent.type(screen.getByLabelText('Query'), 'what milk');
    await userEvent.click(screen.getByRole('button', { name: 'Recall' }));

    await waitFor(() => {
      expect(mockCloudFetch).toHaveBeenCalledWith(
        '/v1/dashboard/memory/recall',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText('oat milk')).toBeInTheDocument();
    expect(await screen.findByText('0.912')).toBeInTheDocument();
  });

  it('reflect posts to the BFF and shows the result', async () => {
    mockCloudFetch.mockResolvedValueOnce({ consolidated: 2 });
    render(<PlaygroundPage />, { initialEntries: ['/memory/playground'] });

    await userEvent.click(screen.getByRole('button', { name: 'Run reflection' }));

    await waitFor(() => {
      expect(mockCloudFetch).toHaveBeenCalledWith(
        '/v1/dashboard/memory/reflect',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText(/Reflection complete/i)).toBeInTheDocument();
  });
});
