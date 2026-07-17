import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { ChunksPanel } from './chunks-panel';

describe('ChunksPanel (chunk viewer/editor)', () => {
  beforeEach(() => vi.clearAllMocks());

  const wire = () =>
    mockCloudFetch.mockImplementation((path: string, init?: { method?: string }) => {
      if (path.includes('/chunks') && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ items: [{ id: 'chk_1', index: 0, text: 'original text' }] });
      }
      return Promise.resolve({ id: 'chk_1', reembedded: true }); // PATCH
    });

  it('lists a document chunks on open', async () => {
    wire();
    render(<ChunksPanel documentID="doc_1" documentName="README.md" open onOpenChange={() => {}} />);
    expect(await screen.findByText('original text')).toBeInTheDocument();
    expect(screen.getByText('#0')).toBeInTheDocument();
  });

  it('editing a chunk + Save issues a PATCH with the new text (re-embed)', async () => {
    wire();
    render(<ChunksPanel documentID="doc_1" documentName="README.md" open onOpenChange={() => {}} />);
    await screen.findByText('original text');
    await userEvent.click(screen.getByRole('button', { name: /edit chunk 0/i }));
    const ta = screen.getByLabelText('Chunk 0 text');
    await userEvent.clear(ta);
    await userEvent.type(ta, 'corrected text');
    await userEvent.click(screen.getByRole('button', { name: /save & re-embed/i }));

    const patch = mockCloudFetch.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'PATCH');
    expect(patch).toBeTruthy();
    expect(patch![0] as string).toContain('/v1/dashboard/rag/chunks/chk_1');
    const body = JSON.parse((patch![1] as { body: string }).body) as { text: string };
    expect(body.text).toBe('corrected text');
  });

  it('Save is disabled until the text actually changes', async () => {
    wire();
    render(<ChunksPanel documentID="doc_1" documentName="README.md" open onOpenChange={() => {}} />);
    await screen.findByText('original text');
    await userEvent.click(screen.getByRole('button', { name: /edit chunk 0/i }));
    expect(screen.getByRole('button', { name: /save & re-embed/i })).toBeDisabled();
  });
});
