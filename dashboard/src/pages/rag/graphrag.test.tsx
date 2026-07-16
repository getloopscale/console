import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));
// react-force-graph-2d renders to a <canvas> (no-op in jsdom) — stub it to a div exposing the node count.
vi.mock('react-force-graph-2d', () => ({
  default: (props: { graphData: { nodes: unknown[]; links: unknown[] } }) => (
    <div data-testid="force-graph">
      {props.graphData.nodes.length} nodes / {props.graphData.links.length} links
    </div>
  ),
}));

import { RagGraphRagPage } from './graphrag';

const wire = () =>
  mockCloudFetch.mockImplementation((path: string) => {
    if (path === '/v1/dashboard/rag/collections') return Promise.resolve({ items: [{ id: 'col_1', name: 'docs' }] });
    if (path.includes('/graph'))
      return Promise.resolve({
        nodes: [
          { id: 'e1', name: 'Alice', type: 'person', degree: 3, community_key: '0:1' },
          { id: 'e2', name: 'Bob', type: 'person', degree: 1, community_key: '0:1' },
        ],
        edges: [{ source: 'e1', target: 'e2', weight: 2 }],
      });
    if (path.includes('/communities'))
      return Promise.resolve({
        communities: [
          { community_key: '0:1', level: 0, size: 5, summary: 'People and their relationships', member_names: ['Alice', 'Bob'] },
        ],
      });
    return Promise.resolve({ answer: 'community answer [c1]', router: { strategy: 'global' } }); // POST /answers
  });

async function pickCollection() {
  await userEvent.click(await screen.findByRole('combobox', { name: 'Collection' }));
  await userEvent.click(await screen.findByRole('option', { name: 'docs' }));
}

describe('RagGraphRagPage (/rag/graphrag) — always-on explorer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the knowledge graph + community reports on collection pick — NO question needed', async () => {
    wire();
    render(<RagGraphRagPage />);
    await pickCollection();
    // graph renders always-on (force-graph stub + summary), no Ask required
    expect(await screen.findByTestId('force-graph')).toHaveTextContent('2 nodes / 1 links');
    expect(screen.getByTestId('graph-summary')).toHaveTextContent('2 entities · 1 relationships');
    // community report (the always-generated sensemaking) surfaces
    expect(await screen.findByText(/people and their relationships/i)).toBeInTheDocument();
    expect(screen.getByText('0:1')).toBeInTheDocument();
  });

  it('the level selector re-reads the graph at that Leiden level', async () => {
    wire();
    render(<RagGraphRagPage />);
    await pickCollection();
    await screen.findByTestId('force-graph');
    await userEvent.click(screen.getByRole('combobox', { name: 'Community level' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Level 1' }));
    // a graph read at level=1 was issued
    const lvl1 = mockCloudFetch.mock.calls.find((c) => typeof c[0] === 'string' && (c[0] as string).includes('/graph') && (c[0] as string).includes('level=1'));
    expect(lvl1).toBeTruthy();
  });

  it('Ask (secondary) queries the graph with the global strategy', async () => {
    wire();
    render(<RagGraphRagPage />);
    await pickCollection();
    await screen.findByTestId('force-graph');
    await userEvent.type(screen.getByLabelText('Question'), 'what are the themes?');
    await userEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    await screen.findByText(/community answer/i);
    const askCall = mockCloudFetch.mock.calls.find((c) => c[0] === '/v1/dashboard/rag/answers');
    const body = JSON.parse((askCall![1] as { body: string }).body) as { strategy?: string };
    expect(body.strategy).toBe('global');
  });

  it('M13 — clicking a community report focuses it, and Clear focus resets', async () => {
    wire();
    render(<RagGraphRagPage />);
    await pickCollection();
    const community = await screen.findByRole('button', { name: /focus community 0:1/i });
    expect(community).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(community);
    expect(community).toHaveAttribute('aria-pressed', 'true');
    const clear = await screen.findByRole('button', { name: /clear focus/i });
    await userEvent.click(clear);
    expect(screen.getByRole('button', { name: /focus community 0:1/i })).toHaveAttribute('aria-pressed', 'false');
  });
});
