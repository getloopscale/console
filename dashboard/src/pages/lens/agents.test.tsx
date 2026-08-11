import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensAgentsPage } from './agents';

describe('LensAgentsPage (/observability/agents)', () => {
  beforeEach(() => vi.clearAllMocks());

  // M74 (audit AG-1) — the empty state must explain the `agent.name` prerequisite so a workspace
  // with non-agentic traces understands WHY the catalog is empty (not "the product lost my data").
  it('M74 — the empty state names the agent.name prerequisite + a docs CTA', async () => {
    mockCloudFetch.mockResolvedValue({ agents: [] });
    render(<LensAgentsPage />);
    // the prerequisite attribute is named in the copy
    expect(await screen.findByText(/agent\.name/i)).toBeInTheDocument();
    // and there is an actionable link to the observability docs
    const cta = screen.getByRole('link', { name: /instrument/i });
    expect(cta).toHaveAttribute('href', expect.stringMatching(/observability/i));
  });

  it('renders the derived catalog when agents are present', async () => {
    mockCloudFetch.mockResolvedValue({ agents: [{ name: 'research_agent', traceCount: 12 }] });
    render(<LensAgentsPage />);
    expect(await screen.findByText('research_agent')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    // the empty-state prerequisite copy must NOT show when data is present
    expect(screen.queryByText(/agent\.name/i)).not.toBeInTheDocument();
  });
});
