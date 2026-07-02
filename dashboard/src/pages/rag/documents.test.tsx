import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { RagDocumentsPage } from './documents';

describe('RagDocumentsPage (/rag/documents)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists a collection documents with ingest status after selecting a collection', async () => {
    mockCloudFetch.mockImplementation((path: string) => {
      if (path.startsWith('/v1/dashboard/rag/collections')) return Promise.resolve({ items: [{ id: 'col_1', name: 'docs' }] });
      return Promise.resolve({ items: [{ id: 'doc_1', name: 'readme', status: 'ready' }] });
    });
    render(<RagDocumentsPage />);
    // before selecting → prompt
    expect(await screen.findByText(/pick a collection/i)).toBeInTheDocument();
    await screen.findByRole('option', { name: 'docs' });
    await userEvent.selectOptions(screen.getByLabelText('Collection'), 'col_1');
    expect(await screen.findByText('readme')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument(); // status badge
  });
});
