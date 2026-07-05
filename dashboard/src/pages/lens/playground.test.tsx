import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, Toaster, violetForge } from '@usetheo/ui';
import { PageMetaProvider } from '@/hooks/use-page-meta';
import { LensPlayground } from './playground';
import type { TraceSpanNode } from './trace-detail';

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

function renderPg(span: TraceSpanNode): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return rtlRender(<LensPlayground span={span} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <ThemeProvider themes={[violetForge]} defaultTheme="violet-forge" defaultMode="dark">
          <Toaster>
            <PageMetaProvider>{children}</PageMetaProvider>
          </Toaster>
        </ThemeProvider>
      </QueryClientProvider>
    ),
  });
}

const llmSpan: TraceSpanNode = {
  spanId: 's1',
  traceId: 'tr-1',
  name: 'llm chat',
  model: 'claude-x',
  inputValue: JSON.stringify([{ role: 'user', content: 'hello world' }]),
  outputValue: 'original answer',
  inputTokens: 10,
  outputTokens: 5,
  startTimeUnixNano: '1000000000',
  endTimeUnixNano: '1002000000',
};

const OK = { output: 'edited answer', promptTokens: 12, completionTokens: 7, totalTokens: 19, latencyMs: 321, model: 'claude-x' };

beforeEach(() => mockCloudFetch.mockReset());

describe('LensPlayground', () => {
  it('prefills the span input as an editable message, runs it, and shows the new output', async () => {
    mockCloudFetch.mockResolvedValue(OK);
    renderPg(llmSpan);
    // prefilled message content
    expect(screen.getByDisplayValue('hello world')).toBeInTheDocument();
    // edit the content then Run
    const ta = screen.getByDisplayValue('hello world');
    await userEvent.clear(ta);
    await userEvent.type(ta, 'edited prompt');
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }));
    await waitFor(() => expect(screen.getByTestId('replay-output')).toHaveTextContent('edited answer'));
    // the POST went to the per-tenant replay proxy with the edited messages (find it among all calls —
    // the datasets query fires afterwards once there's a result).
    const replayCall = mockCloudFetch.mock.calls.find(([p]) => p === '/v1/dashboard/lens/traces/tr-1/replay');
    expect(replayCall).toBeDefined();
    expect((replayCall![1] as { method: string }).method).toBe('POST');
    expect(JSON.stringify(replayCall![1])).toContain('edited prompt');
  });

  it('shows the replay tokens + latency next to the original (no mutation of the original panel)', async () => {
    mockCloudFetch.mockResolvedValue(OK);
    renderPg(llmSpan);
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }));
    await waitFor(() => expect(screen.getByTestId('replay-output')).toBeInTheDocument());
    // replay metrics
    expect(screen.getByTestId('replay-metrics')).toHaveTextContent('19'); // total tokens
    expect(screen.getByTestId('replay-metrics')).toHaveTextContent('321'); // latency ms
    // the ORIGINAL is unchanged — still shows the original answer + original tokens
    expect(screen.getByTestId('original-output')).toHaveTextContent('original answer');
  });

  it('a provider/cross-tenant failure surfaces a typed error, not a silent hang', async () => {
    // reject ONLY the replay call (a stray provider fetch resolves harmlessly).
    mockCloudFetch.mockImplementation((p?: string) =>
      typeof p === 'string' && p.endsWith('/replay') ? Promise.reject(new Error('replay unavailable')) : Promise.resolve(null),
    );
    renderPg(llmSpan);
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }));
    await waitFor(() => expect(screen.getByTestId('replay-error')).toBeInTheDocument());
    expect(screen.queryByTestId('replay-output')).not.toBeInTheDocument();
  });

  it('renders the output as plain text (no dangerouslySetInnerHTML / no script execution)', async () => {
    mockCloudFetch.mockResolvedValue({ ...OK, output: '<img src=x onerror=alert(1)>' });
    renderPg(llmSpan);
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }));
    await waitFor(() => expect(screen.getByTestId('replay-output')).toBeInTheDocument());
    // the payload is shown as literal text, not parsed into an <img>
    expect(screen.getByTestId('replay-output').textContent).toContain('<img src=x onerror=alert(1)>');
    expect(within(screen.getByTestId('replay-output')).queryByRole('img')).toBeNull();
  });

  it('opt-in "Save as dataset item" posts the replayed input+output to the chosen dataset', async () => {
    // first the datasets list, then the replay, then the save
    mockCloudFetch.mockImplementation((path?: string, opts?: { method?: string }) => {
      if (typeof path !== 'string') return Promise.resolve(null); // stray provider fetch
      if (path === '/v1/dashboard/lens/datasets') return Promise.resolve({ datasets: [{ id: 'ds-1', name: 'golden' }] });
      if (path.endsWith('/replay')) return Promise.resolve(OK);
      if (path.includes('/datasets/ds-1/items') && opts?.method === 'POST') return Promise.resolve({ id: 'item-1' });
      return Promise.resolve({});
    });
    renderPg(llmSpan);
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }));
    await waitFor(() => expect(screen.getByTestId('replay-output')).toBeInTheDocument());
    // the save action appears only after a result
    await userEvent.click(screen.getByRole('button', { name: /save as dataset item/i }));
    await waitFor(() =>
      expect(mockCloudFetch.mock.calls.some(([p, o]) => String(p).includes('/datasets/ds-1/items') && (o as { method?: string })?.method === 'POST')).toBe(true),
    );
    // the POST carries the replayed input+output (a synthetic dataset item — no traceId).
    const saveCall = mockCloudFetch.mock.calls.find(([p, o]) => String(p).includes('/datasets/ds-1/items') && (o as { method?: string })?.method === 'POST');
    expect(JSON.stringify(saveCall![1])).toContain('edited answer');
  });

  it('a failed save surfaces an error, not a silent no-op', async () => {
    mockCloudFetch.mockImplementation((path?: string, opts?: { method?: string }) => {
      if (typeof path !== 'string') return Promise.resolve(null);
      if (path === '/v1/dashboard/lens/datasets') return Promise.resolve({ datasets: [{ id: 'ds-1', name: 'golden' }] });
      if (path.endsWith('/replay')) return Promise.resolve(OK);
      if (path.includes('/datasets/ds-1/items') && opts?.method === 'POST') return Promise.reject(new Error('save failed'));
      return Promise.resolve({});
    });
    renderPg(llmSpan);
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }));
    await waitFor(() => expect(screen.getByTestId('replay-output')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /save as dataset item/i }));
    await waitFor(() => expect(screen.getByTestId('save-error')).toBeInTheDocument());
  });
});
