import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { RagGraphRagPage } from './graphrag';

const wire = (answer: Record<string, unknown> = { answer: 'community answer [c1]', router: { strategy: 'global' } }) =>
  mockCloudFetch.mockImplementation((path: string) => {
    if (path === '/v1/dashboard/rag/collections') return Promise.resolve({ items: [{ id: 'col_1', name: 'docs' }] });
    if (path.startsWith('/v1/dashboard/rag/analytics'))
      return Promise.resolve({ scale: { communities: { total: 17, max_level: 1, per_level: { '0': 7, '1': 10 } } } });
    return Promise.resolve(answer); // POST /answers
  });

describe('RagGraphRagPage (/rag/graphrag)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks with the default Global sensemaking strategy and surfaces the answer', async () => {
    wire();
    render(<RagGraphRagPage />);
    await userEvent.click(await screen.findByRole('combobox', { name: 'Collection' }));
    await userEvent.click(await screen.findByRole('option', { name: 'docs' }));
    await userEvent.type(screen.getByLabelText('Question'), 'summarize the corpus');
    await userEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await screen.findByText(/community answer/i);
    const askCall = mockCloudFetch.mock.calls.find((c) => c[0] === '/v1/dashboard/rag/answers');
    const body = JSON.parse((askCall![1] as { body: string }).body) as { strategy?: string };
    expect(body.strategy).toBe('global'); // GraphRAG destination — never the default vector
    expect(screen.getByText('global')).toBeInTheDocument(); // router trace badge
  });

  it('switching mode to Entity graph sends strategy=graph', async () => {
    wire({ answer: 'graph traversal answer', router: { strategy: 'graph' } });
    render(<RagGraphRagPage />);
    await userEvent.click(await screen.findByRole('combobox', { name: 'Collection' }));
    await userEvent.click(await screen.findByRole('option', { name: 'docs' }));
    await userEvent.type(screen.getByLabelText('Question'), 'how are X and Y related?');
    await userEvent.click(screen.getByRole('combobox', { name: 'GraphRAG mode' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Entity graph' }));
    await userEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await screen.findByText(/graph traversal answer/i);
    const askCall = mockCloudFetch.mock.calls.find((c) => c[0] === '/v1/dashboard/rag/answers');
    const body = JSON.parse((askCall![1] as { body: string }).body) as { strategy?: string };
    expect(body.strategy).toBe('graph');
  });

  it('renders the knowledge-graph communities panel from the analytics scale block', async () => {
    wire();
    render(<RagGraphRagPage />);
    // Before a collection is picked, the panel prompts for one.
    expect(await screen.findByText(/select a collection to see its graph communities/i)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('combobox', { name: 'Collection' }));
    await userEvent.click(await screen.findByRole('option', { name: 'docs' }));
    // Communities count + per-level breakdown surface from scale.communities.
    expect(await screen.findByText('17')).toBeInTheDocument();
    expect(screen.getByText('Level 0')).toBeInTheDocument();
    expect(screen.getByText('Level 1')).toBeInTheDocument();
  });
});
