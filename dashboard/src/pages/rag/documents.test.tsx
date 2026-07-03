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
    // M23: the collection picker is now the @usetheo/ui Select (Radix) — open the
    // trigger (role combobox), then click the option in the portal.
    await userEvent.click(await screen.findByRole('combobox', { name: 'Collection' }));
    await userEvent.click(await screen.findByRole('option', { name: 'docs' }));
    expect(await screen.findByText('readme')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument(); // status badge
  });
});
