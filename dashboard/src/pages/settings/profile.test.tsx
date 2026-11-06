import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({
    active: true,
    identity: {
      id: 'sess-1',
      traits: { email: 'paulo@example.com', name: 'Paulo' },
    },
  }),
}));

const mockEngineFetch = vi.fn();
// B-265 — the delete is keyed on the TENANT id, and this screen reads it from `useWhoami`, the
// same source the Settings screen next door uses. Before that fix it passed `session.identity.id`
// (below, `sess-1`) and the engine could only answer 403: its handler compares the path parameter
// against `uc.TenantID`. The URL asserted further down USED to be `/api/v1/tenants/sess-1` — a
// test that pinned the defect, which is why it had to move with the fix.
vi.mock('@/hooks/settings/use-whoami', () => ({
  useWhoami: () => ({ whoami: { user_id: 'sess-1', email: 'u@x.com', team_id: 'tn-1', team_slug: 't' } }),
}));

vi.mock('@/lib/http/api', async (io) => {
  const actual = await io<typeof import('@/lib/http/api')>();
  return { ...actual, engineFetch: (...a: unknown[]) => mockEngineFetch(...a) };
});

vi.mock('@/lib/auth/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/session')>('@/lib/auth/session');
  return {
    ...actual,
    logout: vi.fn(),
  };
});

import { ProfilePage } from './profile';

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_profile_renders_avatar_with_session_data', () => {
    const { container } = render(<ProfilePage />);
    // Avatar.Fallback content (initial "P") is only painted by Radix after image
    // load fails — jsdom never fires that event so the fallback stays empty.
    // Assert via the Avatar wrapper span class (size-12) + session-data text.
    expect(container.querySelector('.size-12')).toBeInTheDocument();
    expect(screen.getByText('Paulo')).toBeInTheDocument();
    // T-D.1 (P-3): email is masked preserving full domain.
    // "paulo@example.com" → "p****@example.com" (5-char local → 1 + min(4,8) stars)
    expect(screen.getByText(/p\*\*\*\*@example\.com/)).toBeInTheDocument();
  });

  it('test_profile_updates_display_name', () => {
    // Plan v1.2 divergence: display-name update goes through Kratos self-service
    // settings flow (deferred to follow-up). Verify Sign-out button present
    // (current MVP scope).
    render(<ProfilePage />);
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('test_profile_delete_account_requires_email_phrase', async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);
    const deleteAccountButtons = screen.getAllByRole('button', { name: /delete account/i });
    await user.click(deleteAccountButtons[0]);
    // ConfirmDialog opens with confirmationPhrase={email} (paulo@example.com)
    expect(screen.getByText(/This will permanently delete your account/i)).toBeInTheDocument();
  });

  // Red Team theo-cloud#79 closure: the /profile page used to jump h1
  // ("Profile") → h3 ("Account"), skipping h2. The Card.Title default of
  // h3 was promoted to h2 via asChild so the heading outline reads
  // unbroken to screen readers.
  it('profile page heading hierarchy goes h1 → h2 without skipping (#79)', () => {
    render(<ProfilePage />);
    const headings = screen.getAllByRole('heading');
    const levels = headings.map((h) => parseInt(h.tagName.slice(1), 10));
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeLessThanOrEqual(levels[i - 1] + 1);
    }
    expect(levels).toContain(2);
  });

  // Red Team theo-cloud#71 closure: a 20 000-char display name made
  // document.body.scrollWidth balloon to 179 512px (vs viewport 1850px).
  // The fix is structural — the name <p> MUST carry max-width + overflowWrap
  // so a runaway string can never blow out the page layout regardless of
  // what shipped through Kratos (the server-side schema cap closes #65 in
  // parallel; this protects against any future bypass).
  it('long display name is layout-bounded via max-width + overflowWrap (#71)', () => {
    // Re-mock identity with a 20 000-char name to exercise the path.
    vi.doMock('@/hooks/use-auth', () => ({
      useRequireAuth: () => ({
        active: true,
        identity: {
          id: 'sess-71',
          traits: { email: 'paulo@example.com', name: 'A'.repeat(20_000) },
        },
      }),
    }));
    render(<ProfilePage />);
    const nameEl = screen.getByTestId('profile-name') as HTMLElement;
    // RED #71: the inline style MUST set overflowWrap so a giant token
    // breaks intra-word (browsers honor `anywhere` strictly).
    expect(nameEl.style.overflowWrap).toBe('anywhere');
    // RED #71: a max-width class MUST be present so the column refuses
    // to grow horizontally past the card edge.
    expect(nameEl.className).toMatch(/max-w-/);
  });
});


describe('ProfilePage — deleting the account (B-264)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function confirmDelete() {
    await userEvent.click(screen.getByRole('button', { name: /delete account/i }));
    // The dialog gates confirm behind typing the account email (type-to-confirm).
    await userEvent.type(await screen.findByRole('textbox'), 'paulo@example.com');
    await userEvent.click(screen.getByRole('button', { name: /delete my account/i }));
  }

  it('signs the user out when the delete SUCCEEDS', async () => {
    mockEngineFetch.mockResolvedValue({});
    const { logout } = await import('@/lib/auth/session');

    render(<ProfilePage />);
    await confirmDelete();

    expect(mockEngineFetch).toHaveBeenCalledWith(
      '/api/v1/tenants/tn-1',
      expect.objectContaining({ method: 'DELETE' }),
      expect.objectContaining({ throwOnError: true }),
    );
    await vi.waitFor(() => expect(vi.mocked(logout)).toHaveBeenCalled());
  });

  it('treats a 204 (null body) as the success a DELETE means', async () => {
    // Note the reversal, and it is the point of B-235. BEFORE the fix, `null` meant "something
    // went wrong and I cannot say what". AFTER it, a non-2xx REJECTS, so the only `null` left
    // is a 2xx with no body — which for a DELETE is a legitimate 204. The same value means
    // opposite things on either side of the fix, which is why the ambiguity had to go.
    mockEngineFetch.mockResolvedValue(null);
    const { logout } = await import('@/lib/auth/session');

    render(<ProfilePage />);
    await confirmDelete();

    await vi.waitFor(() => expect(vi.mocked(logout)).toHaveBeenCalled());
  });

  it('does NOT sign the user out when the server REJECTS with a reason', async () => {
    mockEngineFetch.mockRejectedValue(new Error('tenant has active subscriptions'));
    const { logout } = await import('@/lib/auth/session');

    render(<ProfilePage />);
    await confirmDelete();

    await vi.waitFor(() =>
      expect(document.body.textContent ?? '').toMatch(/tenant has active subscriptions/i),
    );
    expect(vi.mocked(logout)).not.toHaveBeenCalled();
  });
});
