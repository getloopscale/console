import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

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

  // M9 — a selected retrieval strategy reaches the BFF, so a user can pick GraphRAG
  // (Global sensemaking / Entity graph) from the dashboard, and the answering strategy shows.
  it('M9 — a selected strategy (Global sensemaking) is sent to the BFF + surfaced on the answer', async () => {
    mockCloudFetch.mockImplementation((path: string) => {
      if (path === '/v1/dashboard/rag/collections') return Promise.resolve({ items: [{ id: 'col_1', name: 'docs' }] });
      return Promise.resolve({ answer: 'community answer [c1]', sources: [], router: { strategy: 'global' } });
    });
    render(<RagAskPage />);
    await userEvent.click(await screen.findByRole('combobox', { name: 'Collection' }));
    await userEvent.click(await screen.findByRole('option', { name: 'docs' }));
    await userEvent.type(screen.getByLabelText('Question'), 'summarize the corpus');
    await userEvent.click(screen.getByRole('combobox', { name: 'Retrieval strategy' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Global sensemaking' }));
    await userEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await screen.findByText(/community answer/i);
    const askCall = mockCloudFetch.mock.calls.find((c) => c[0] === '/v1/dashboard/rag/answers');
    expect(askCall).toBeTruthy();
    const body = JSON.parse((askCall![1] as { body: string }).body) as { strategy?: string };
    expect(body.strategy).toBe('global');
    expect(screen.getByText('global')).toBeInTheDocument(); // router trace surfaced on the answer
  });

  // M9 — the default (Fast/vector) omits strategy so the request stays byte-identical to pre-M9.
  it('M9 — the default strategy is omitted from the request (backward-compatible)', async () => {
    mockCloudFetch.mockImplementation((path: string) => {
      if (path === '/v1/dashboard/rag/collections') return Promise.resolve({ items: [{ id: 'col_1', name: 'docs' }] });
      return Promise.resolve({ answer: 'ok [c1]', sources: [] });
    });
    render(<RagAskPage />);
    await userEvent.click(await screen.findByRole('combobox', { name: 'Collection' }));
    await userEvent.click(await screen.findByRole('option', { name: 'docs' }));
    await userEvent.type(screen.getByLabelText('Question'), 'q');
    await userEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await screen.findByText(/^ok/i);
    const askCall = mockCloudFetch.mock.calls.find((c) => c[0] === '/v1/dashboard/rag/answers');
    const body = JSON.parse((askCall![1] as { body: string }).body) as Record<string, unknown>;
    expect('strategy' in body).toBe(false);
  });
});
