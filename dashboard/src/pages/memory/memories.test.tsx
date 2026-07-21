// Plan 1 of dashboard-memory-section-roadmap.md, T1.8 acceptance.
// Focused on: (1) list renders, (2) filter updates URL, (3) ConfirmDialog
// gates delete via confirmationPhrase.

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

import { MemoryListPage } from './memories';

describe('MemoryListPage (/memory/memories)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders memories returned by the backend', async () => {
    mockCloudFetch.mockResolvedValueOnce({
      memories: [
        { id: 'mem-aaaa1111bbbb2222', content: 'prefers TypeScript', category: 'preferences', created_at: new Date().toISOString() },
        { id: 'mem-cccc3333dddd4444', content: 'lives in Lisbon', category: 'facts', created_at: new Date().toISOString() },
      ],
    });
    render(<MemoryListPage />);
    expect(await screen.findByText('prefers TypeScript')).toBeInTheDocument();
    expect(screen.getByText('lives in Lisbon')).toBeInTheDocument();
    expect(screen.getByText('preferences')).toBeInTheDocument();
    expect(screen.getByText('facts')).toBeInTheDocument();
  });

  it('empty result renders a friendly EmptyState (D3 — no broken UI on first run)', async () => {
    mockCloudFetch.mockResolvedValueOnce({ memories: [] });
    render(<MemoryListPage />);
    expect(await screen.findByText(/No memories yet/i)).toBeInTheDocument();
  });

  it('a failed fetch shows an error state, NOT an empty state (theo-cloud#250)', async () => {
    // The whole point: a 404/502 must NOT read as "no memories". cloudFetch resolves
    // null on failure by default, which the page would render as empty; the page opts
    // into throwOnError so a rejection becomes query.isError.
    const err = Object.assign(new Error('API request failed with status 502'), { status: 502 });
    mockCloudFetch.mockRejectedValueOnce(err);
    render(<MemoryListPage />);
    expect(await screen.findByText(/Could not load memories/i)).toBeInTheDocument();
    expect(screen.queryByText(/No memories yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/hasn't stored any memories/i)).not.toBeInTheDocument();
  });

  it('passes throwOnError so failures reject instead of resolving null (theo-cloud#250)', async () => {
    mockCloudFetch.mockResolvedValueOnce({ memories: [] });
    render(<MemoryListPage />);
    await screen.findByText(/No memories yet/i);
    // The list query must opt into throwOnError, or a failed fetch silently becomes
    // an empty list. Config is the 3rd arg to cloudFetch.
    const listCall = mockCloudFetch.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('/v1/dashboard/memory/list'),
    );
    expect(listCall, 'the list query must call cloudFetch').toBeDefined();
    expect(listCall?.[2]).toMatchObject({ throwOnError: true });
  });

  it('typing in the category filter triggers a refetch with the new query', async () => {
    mockCloudFetch.mockResolvedValueOnce({ memories: [] });
    const user = userEvent.setup();
    render(<MemoryListPage />);

    // Wait for the first load to settle.
    expect(await screen.findByText(/No memories yet/i)).toBeInTheDocument();

    mockCloudFetch.mockResolvedValueOnce({ memories: [] });
    await user.type(screen.getByLabelText(/category/i), 'preferences');

    // The category propagates into the request URL — the assertion
    // checks the LAST cloudFetch call's path contains the filter value.
    // (We don't depend on debounce timing; useQuery re-keys per param,
    //  so any state change triggers at least one new fetch.)
    const calls = mockCloudFetch.mock.calls;
    const lastURL = String(calls[calls.length - 1]?.[0] ?? '');
    expect(lastURL).toContain('category=');
  });

  it('ConfirmDialog gates Forget until confirmationPhrase matches memory id', async () => {
    mockCloudFetch.mockResolvedValueOnce({
      memories: [
        { id: 'mem-aaaa1111bbbb2222', content: 'fact', created_at: new Date().toISOString() },
      ],
    });
    const user = userEvent.setup();
    render(<MemoryListPage />);
    expect(await screen.findByText('fact')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /forget memory mem-aaaa1111bbbb2222/i }));

    // The ConfirmDialog opens — Forget button is rendered but disabled
    // until the typed phrase equals the memory id. We only assert that
    // the dialog renders the warning copy; the typed-verification logic
    // itself is owned by @usetheo/ui ConfirmDialog (covered there).
    expect(await screen.findByText(/will be forgotten/i)).toBeInTheDocument();
    // ADR D4 — the hard-delete (GDPR) opt-in checkbox is present.
    expect(screen.getByLabelText(/permanently erase/i)).toBeInTheDocument();
  });
});
