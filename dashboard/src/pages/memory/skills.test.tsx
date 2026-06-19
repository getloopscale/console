// dashboard-phase2b-skills-browse T4.1 — Skills browse tab.
// Read-only: repoId input → fetch → DataTable. No executor/editor/delete (D4).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({
    active: true,
    identity: { id: 't', traits: { email: 'u@x.com' } },
  }),
}));

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
  engineFetch: (...args: unknown[]) => mockCloudFetch(...args),
}));

import { SkillsPage } from './skills';

describe('SkillsPage (/memory/skills)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a repo-required hint and does NOT fetch when repoId is empty', async () => {
    render(<SkillsPage />);
    expect(await screen.findByText(/enter a repo/i)).toBeInTheDocument();
    expect(mockCloudFetch).not.toHaveBeenCalled();
  });

  it('fetches and renders skill rows after entering a repoId', async () => {
    mockCloudFetch.mockResolvedValue({
      skills: [
        {
          id: 's1',
          hash: 'h1',
          description: 'deploy the service',
          code: 'kubectl apply',
          codeLanguage: 'bash',
          createdAt: '2026-06-01T00:00:00Z',
          derivedFrom: [],
          supersededBy: null,
        },
      ],
      truncated: false,
    });
    render(<SkillsPage />);
    const input = await screen.findByLabelText(/repo/i);
    await userEvent.type(input, 'acme');
    expect(await screen.findByText('deploy the service')).toBeInTheDocument();
    expect(mockCloudFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/dashboard/memory/skills?repoId=acme'),
    );
  });

  it('shows the empty message when the repo has no skills', async () => {
    mockCloudFetch.mockResolvedValue({ skills: [], truncated: false });
    render(<SkillsPage />);
    const input = await screen.findByLabelText(/repo/i);
    await userEvent.type(input, 'empty');
    expect(await screen.findByText(/no skills/i)).toBeInTheDocument();
  });

  it('EC-3: renders a skill with null code without crashing', async () => {
    mockCloudFetch.mockResolvedValue({
      skills: [
        {
          id: 'd1',
          hash: 'h',
          description: 'derived skill',
          code: null,
          codeLanguage: null,
          createdAt: '2026-06-01T00:00:00Z',
          derivedFrom: ['a', 'b'],
          supersededBy: null,
        },
      ],
      truncated: false,
    });
    render(<SkillsPage />);
    const input = await screen.findByLabelText(/repo/i);
    await userEvent.type(input, 'acme');
    expect(await screen.findByText('derived skill')).toBeInTheDocument();
  });

  it('EC-4: discloses truncation when the response is capped', async () => {
    mockCloudFetch.mockResolvedValue({
      skills: [
        {
          id: 's1',
          hash: 'h1',
          description: 'one',
          code: 'x',
          codeLanguage: 'bash',
          createdAt: '2026-06-01T00:00:00Z',
          derivedFrom: [],
          supersededBy: null,
        },
      ],
      truncated: true,
    });
    render(<SkillsPage />);
    const input = await screen.findByLabelText(/repo/i);
    await userEvent.type(input, 'acme');
    expect(await screen.findByText(/showing the first/i)).toBeInTheDocument();
  });

  it('renders NO delete/run/edit controls (read-only, D4)', async () => {
    mockCloudFetch.mockResolvedValue({
      skills: [
        {
          id: 's1',
          hash: 'h1',
          description: 'one',
          code: 'x',
          codeLanguage: 'bash',
          createdAt: '2026-06-01T00:00:00Z',
          derivedFrom: [],
          supersededBy: null,
        },
      ],
      truncated: false,
    });
    render(<SkillsPage />);
    const input = await screen.findByLabelText(/repo/i);
    await userEvent.type(input, 'acme');
    await screen.findByText('one');
    expect(screen.queryByRole('button', { name: /delete|forget|run|edit/i })).toBeNull();
  });
});
