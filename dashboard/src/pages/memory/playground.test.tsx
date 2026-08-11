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
vi.mock('@/lib/http/api', () => ({
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
        expect.objectContaining({ throwOnError: true }),
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
        expect.objectContaining({ throwOnError: true }),
      );
    });
    expect(await screen.findByText('oat milk')).toBeInTheDocument();
    expect(await screen.findByText('0.912')).toBeInTheDocument();
  });

  it('recall omits graphExpand by default (toggle off) — EG-1', async () => {
    mockCloudFetch.mockResolvedValueOnce({ results: [] });
    render(<PlaygroundPage />, { initialEntries: ['/memory/playground'] });
    await userEvent.type(screen.getByLabelText('Query'), 'what milk');
    await userEvent.click(screen.getByRole('button', { name: 'Recall' }));
    await waitFor(() => expect(mockCloudFetch).toHaveBeenCalled());
    const call = mockCloudFetch.mock.calls.find((c) => c[0] === '/v1/dashboard/memory/recall');
    const body = JSON.parse((call?.[1] as { body: string }).body) as Record<string, unknown>;
    expect(body).not.toHaveProperty('graphExpand');
  });

  it('recall sends graphExpand when the toggle is on — EG-1', async () => {
    mockCloudFetch.mockResolvedValueOnce({ results: [] });
    render(<PlaygroundPage />, { initialEntries: ['/memory/playground'] });
    await userEvent.type(screen.getByLabelText('Query'), 'what milk');
    await userEvent.click(screen.getByLabelText('Graph expand'));
    await userEvent.selectOptions(screen.getByLabelText('Graph expand hops'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Recall' }));
    await waitFor(() => expect(mockCloudFetch).toHaveBeenCalled());
    const call = mockCloudFetch.mock.calls.find((c) => c[0] === '/v1/dashboard/memory/recall');
    const body = JSON.parse((call?.[1] as { body: string }).body) as { graphExpand?: { hops: number } };
    expect(body.graphExpand).toEqual({ hops: 2 });
  });

  it('reflect posts to the BFF and shows the result', async () => {
    mockCloudFetch.mockResolvedValueOnce({ consolidated: 2 });
    render(<PlaygroundPage />, { initialEntries: ['/memory/playground'] });

    await userEvent.click(screen.getByRole('button', { name: 'Run reflection' }));

    await waitFor(() => {
      expect(mockCloudFetch).toHaveBeenCalledWith(
        '/v1/dashboard/memory/reflect',
        expect.objectContaining({ method: 'POST' }),
        expect.objectContaining({ throwOnError: true }),
      );
    });
    expect(await screen.findByText(/Reflection complete/i)).toBeInTheDocument();
  });

  // dashboard-memory-error-surfacing T1.2 — the live-test silent-failure fix.
  it('surfaces an error and does NOT clear the form when remember fails', async () => {
    // With the fix, the mutation opts into throwOnError, so a backend non-2xx
    // rejects the mutation -> isError -> the existing Alert renders and the
    // form is NOT cleared (onSuccess never runs).
    mockCloudFetch.mockRejectedValueOnce(new Error('backend 404'));
    render(<PlaygroundPage />, { initialEntries: ['/memory/playground'] });

    const ta = screen.getByLabelText('Memory text to remember');
    await userEvent.type(ta, 'Paulo likes oat milk');
    await userEvent.click(screen.getByRole('button', { name: 'Remember' }));

    // (a) the error Alert renders (no longer dead code)
    expect(await screen.findByText(/Could not remember/i)).toBeInTheDocument();
    // (b) the form is retained (not silently cleared on failure)
    expect((ta as HTMLTextAreaElement).value).toBe('Paulo likes oat milk');
    // (c) the wiring: remember opted into throwOnError (regression guard for the fix)
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/memory/remember',
      expect.objectContaining({ method: 'POST' }),
      expect.objectContaining({ throwOnError: true }),
    );
  });

  it('recall surfaces an error when the backend fails', async () => {
    mockCloudFetch.mockRejectedValueOnce(new Error('backend 500'));
    render(<PlaygroundPage />, { initialEntries: ['/memory/playground'] });
    await userEvent.type(screen.getByLabelText('Query'), 'what milk');
    await userEvent.click(screen.getByRole('button', { name: 'Recall' }));
    expect(await screen.findByText(/Could not recall/i)).toBeInTheDocument();
  });

  // Phase 2A — attribution-write.
  it('remember includes attributedTo when a peer is given', async () => {
    mockCloudFetch.mockResolvedValueOnce({ items: [{ id: 'm1', content: 'x' }] });
    render(<PlaygroundPage />, { initialEntries: ['/memory/playground'] });

    await userEvent.type(screen.getByLabelText('Memory text to remember'), 'Paulo likes oat milk');
    await userEvent.type(screen.getByLabelText('Attributed to (peer, optional)'), 'maria');
    await userEvent.click(screen.getByRole('button', { name: 'Remember' }));

    await waitFor(() => expect(mockCloudFetch).toHaveBeenCalled());
    const body = JSON.parse(mockCloudFetch.mock.calls.at(-1)![1].body as string);
    expect(body.attributedTo).toBe('maria');
  });

  // EC-2 — whitespace-only peer is omitted.
  it('remember omits attributedTo when the peer field is whitespace', async () => {
    mockCloudFetch.mockResolvedValueOnce({ items: [{ id: 'm1', content: 'x' }] });
    render(<PlaygroundPage />, { initialEntries: ['/memory/playground'] });

    await userEvent.type(screen.getByLabelText('Memory text to remember'), 'fact');
    await userEvent.type(screen.getByLabelText('Attributed to (peer, optional)'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Remember' }));

    await waitFor(() => expect(mockCloudFetch).toHaveBeenCalled());
    const body = JSON.parse(mockCloudFetch.mock.calls.at(-1)![1].body as string);
    expect(body).not.toHaveProperty('attributedTo');
  });

  // Phase 2A — bi-temporal asOf + EC-1 RFC3339 widening validity.
  it('recall includes a valid RFC3339 asOf from the datetime-local picker', async () => {
    mockCloudFetch.mockResolvedValueOnce({ results: [] });
    render(<PlaygroundPage />, { initialEntries: ['/memory/playground'] });

    await userEvent.type(screen.getByLabelText('Query'), 'what milk');
    // datetime-local yields minute precision: YYYY-MM-DDTHH:mm
    await userEvent.type(screen.getByLabelText('As of (UTC, optional)'), '2026-06-01T10:30');
    await userEvent.click(screen.getByRole('button', { name: 'Recall' }));

    await waitFor(() => expect(mockCloudFetch).toHaveBeenCalled());
    const body = JSON.parse(mockCloudFetch.mock.calls.at(-1)![1].body as string);
    expect(body.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(body.asOf).toBe('2026-06-01T10:30:00Z');
  });
});
