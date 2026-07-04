import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { within } from '@testing-library/react';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

// Mock the M48 trace-detail's layout lib (jsdom cannot lay it out — see trace-detail.test.tsx).
vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children }: { children: React.ReactNode }) => <div data-testid="panel-group">{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelResizeHandle: (props: Record<string, unknown>) => <div role="separator" {...props} />,
}));

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

  it('opening a trace shows the span tree AND keeps the tags/annotations forms (M47, no regression)', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url === '/v1/dashboard/lens/traces') return Promise.resolve({ traces: [{ traceId: 'tr_1', name: 'checkout' }] });
      if (url === '/v1/dashboard/lens/traces/tr_1')
        return Promise.resolve({ spanId: 's0', traceId: 'tr_1', name: 'checkout.root', children: [] });
      if (url.includes('/tags')) return Promise.resolve({ tags: ['prod'] });
      return Promise.resolve({});
    });
    render(<LensTracesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /open tr_1/i }));
    // span tree renders (M47)
    const treeEl = await screen.findByTestId('span-tree');
    expect(within(treeEl).getByText('checkout.root')).toBeInTheDocument();
    // AND the M44 tags/annotations forms are preserved
    expect(screen.getByLabelText(/new tag/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/new annotation/i)).toBeInTheDocument();
    // the M47 tree fetch is GET-only — opening a trace makes zero mutating calls
    const mutating = mockCloudFetch.mock.calls.filter((c) => {
      const m = (c[1] as { method?: string })?.method;
      return m === 'POST' || m === 'DELETE' || m === 'PUT' || m === 'PATCH';
    });
    expect(mutating).toHaveLength(0);
  });
});
