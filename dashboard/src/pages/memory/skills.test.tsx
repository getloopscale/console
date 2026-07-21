// skills-cross-repo-flat-list-gateway — Skills tab (flat cross-repo listing).
// Lists ALL skills by default (no repoId gate) with a Repo column + search +
// pagination. D2 guardrail preserved: delete-only curation (no editor/executor).

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

function skill(id: string, repoId: string, description: string, code: string | null = 'x'): unknown {
  return {
    id,
    hash: `h-${id}`,
    description,
    code,
    codeLanguage: code === null ? null : 'typescript',
    createdAt: '2026-06-01T00:00:00Z',
    derivedFrom: [],
    supersededBy: null,
    repoId,
  };
}

describe('SkillsPage (/memory/skills)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists skills across repos by default (no repoId gate) with a Repo column', async () => {
    mockCloudFetch.mockResolvedValue({
      skills: [skill('s1', 'repo-a', 'deploy the service'), skill('s2', 'repo-b', 'parse csv')],
      total: 2,
      truncated: false,
    });
    render(<SkillsPage />);
    // Fetches the flat endpoint WITHOUT requiring a repoId.
    expect(await screen.findByText('deploy the service')).toBeInTheDocument();
    expect(screen.getByText('parse csv')).toBeInTheDocument();
    // The Repo column surfaces each row's repoId.
    expect(screen.getByText('repo-a')).toBeInTheDocument();
    expect(screen.getByText('repo-b')).toBeInTheDocument();
    expect(mockCloudFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/dashboard/memory/skills/all?'),
      expect.anything(),
      expect.objectContaining({ throwOnError: true }),
    );
  });

  it('shows an empty-state (not a repo hint) when the subject has no skills', async () => {
    mockCloudFetch.mockResolvedValue({ skills: [], total: 0, truncated: false });
    render(<SkillsPage />);
    expect(await screen.findByText(/no skills yet/i)).toBeInTheDocument();
    // It STILL fetched (no repoId gate) — the key behavior change.
    expect(mockCloudFetch).toHaveBeenCalled();
  });

  it('search forwards the q query param', async () => {
    mockCloudFetch.mockResolvedValue({ skills: [], total: 0, truncated: false });
    render(<SkillsPage />);
    const input = await screen.findByLabelText(/search/i);
    await userEvent.type(input, 'csv');
    // last call carries q=csv
    expect(mockCloudFetch).toHaveBeenLastCalledWith(expect.stringContaining('q=csv'), expect.anything(), expect.objectContaining({ throwOnError: true }));
  });

  it('pagination: Next advances offset; Previous is disabled on the first page', async () => {
    mockCloudFetch.mockResolvedValue({
      skills: Array.from({ length: 25 }, (_, i) => skill(`s${i}`, 'repo-a', `skill ${i}`)),
      total: 60,
      truncated: true,
    });
    render(<SkillsPage />);
    await screen.findByText('skill 0');
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    const next = screen.getByRole('button', { name: /next/i });
    expect(next).toBeEnabled();
    await userEvent.click(next);
    expect(mockCloudFetch).toHaveBeenLastCalledWith(expect.stringContaining('offset=25'), expect.anything(), expect.objectContaining({ throwOnError: true }));
  });

  it('code is NOT a table column; View details opens a dialog with the full code', async () => {
    mockCloudFetch.mockResolvedValue({
      skills: [skill('s1', 'repo-a', 'deploy the service', 'kubectl apply -f deploy.yaml')],
      total: 1,
      truncated: false,
    });
    render(<SkillsPage />);
    await screen.findByText('deploy the service');
    // The raw code is NOT shown inline in the list (kept out of the scannable table).
    expect(screen.queryByText('kubectl apply -f deploy.yaml')).toBeNull();
    // Opening the details view surfaces the full code.
    await userEvent.click(screen.getByRole('button', { name: /view details for skill/i }));
    expect(await screen.findByText('kubectl apply -f deploy.yaml')).toBeInTheDocument();
  });

  it('EC-3: renders a skill with null code without crashing', async () => {
    mockCloudFetch.mockResolvedValue({
      skills: [skill('d1', 'repo-a', 'derived skill', null)],
      total: 1,
      truncated: false,
    });
    render(<SkillsPage />);
    expect(await screen.findByText('derived skill')).toBeInTheDocument();
  });

  it('D2: curation = delete only; NO run/edit/create-code controls', async () => {
    mockCloudFetch.mockResolvedValue({
      skills: [skill('s1', 'repo-a', 'one')],
      total: 1,
      truncated: false,
    });
    render(<SkillsPage />);
    await screen.findByText('one');
    expect(screen.getByRole('button', { name: /forget skill/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /run|execute|edit code|create skill|new skill/i }),
    ).toBeNull();
  });

  it('delete uses the ROW repoId in the DELETE url', async () => {
    mockCloudFetch.mockResolvedValue({
      skills: [skill('s1', 'repo-b', 'deploy thing')],
      total: 1,
      truncated: false,
    });
    render(<SkillsPage />);
    await screen.findByText('deploy thing');
    await userEvent.click(screen.getByRole('button', { name: /forget skill/i }));
    const confirm = await screen.findByRole('button', { name: /^forget skill$/i });
    await userEvent.click(confirm);
    expect(mockCloudFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/dashboard/memory/skills/s1?repoId=repo-b'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
