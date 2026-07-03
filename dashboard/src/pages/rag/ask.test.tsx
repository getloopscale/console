import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { RagAskPage } from './ask';

describe('RagAskPage (/rag/ask)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('submits a question and renders the cited answer', async () => {
    mockCloudFetch.mockImplementation((path: string) => {
      if (path === '/v1/dashboard/rag/collections') return Promise.resolve({ items: [{ id: 'col_1', name: 'docs' }] });
      return Promise.resolve({ answer: 'M18 is the keystone. [c1]', sources: [{ document_id: 'doc_1', score: 0.9 }] });
    });
    render(<RagAskPage />);
    // M23: collection picker is the @usetheo/ui Select (Radix) — open + pick.
    await userEvent.click(await screen.findByRole('combobox', { name: 'Collection' }));
    await userEvent.click(await screen.findByRole('option', { name: 'docs' }));
    await userEvent.type(screen.getByLabelText('Question'), 'what is the keystone?');
    await userEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(await screen.findByText(/M18 is the keystone/i)).toBeInTheDocument();
    expect(screen.getByText(/doc_1/)).toBeInTheDocument(); // cited source
  });
});
