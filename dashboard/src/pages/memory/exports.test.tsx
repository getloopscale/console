// Plan 3 of dashboard-memory-section-roadmap.md, T3.6 acceptance.
// Focused on: empty state, Create export button, status badge, D3
// (EC-15) — polling pause when document.visibilityState === 'hidden'.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen, act } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({
    active: true,
    identity: { id: 't', traits: { email: 'u@x.com' } },
  }),
}));

const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({
  cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
  engineFetch: (...args: unknown[]) => mockCloudFetch(...args),
  getApiBase: () => '',
}));

import { ExportsPage } from './exports';

describe('ExportsPage (/memory/exports)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders empty state and Create button', async () => {
    render(<ExportsPage />);
    expect(await screen.findByText(/no exports yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /create export/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('clicking Create export POSTs and adds the row in pending state', async () => {
    mockCloudFetch.mockResolvedValueOnce({
      id: 'export-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      status: 'pending',
    });
    const user = userEvent.setup();
    render(<ExportsPage />);
    await user.click(
      (await screen.findAllByRole('button', { name: /create export/i }))[0],
    );
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/memory/exports',
      expect.objectContaining({ method: 'POST' }),
      // B-244/B-235 — the third argument is the error contract, not decoration. Without it a
      // refused POST RESOLVES `null`, `onSuccess` fires with that `null`, and the handler's
      // `if (!row?.id) return` swallows it: the user clicks and nothing happens, silently.
      { throwOnError: true },
    );
    // Wait for the row to appear with `pending` status badge.
    expect(await screen.findByTestId('status-export-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBeInTheDocument();
  });

  it('a rejected create surfaces in the Alert the screen already had', async () => {
    // WHAT THIS DOES AND DOES NOT PROVE, because an earlier version of this comment claimed more
    // than the code delivers and a review caught it.
    //
    // It proves the PAGE renders `createMutation.isError`. It does NOT prove the B-244 fix: this
    // mocks a REJECTION, and a rejection already set `isError` in the pre-migration page too — so
    // this case passes unchanged against the old code, which is the definition of a test that
    // cannot fail on the defect it names.
    //
    // The actual defect — a refusal RESOLVING `null`, swallowed by `if (!row?.id) return` — is only
    // observable below the mock, and is covered in `hooks/data-access-error-contract.test.tsx`,
    // which stubs `globalThis.fetch` and lets the real `cloudFetch` run.
    mockCloudFetch.mockRejectedValueOnce(new Error('quota exceeded'));
    const user = userEvent.setup();
    render(<ExportsPage />);
    await user.click((await screen.findAllByRole('button', { name: /create export/i }))[0]);

    expect(await screen.findByText('Could not start export')).toBeInTheDocument();
    // …and no phantom row was added for an export that was never created.
    expect(screen.getByText(/no exports yet/i)).toBeInTheDocument();
  });

  it('D3 (EC-15) — polling SKIPS the status fetch when document.visibilityState is hidden', async () => {
    // Start hidden so the poll body short-circuits.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    mockCloudFetch.mockResolvedValueOnce({
      id: 'export-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      status: 'pending',
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ExportsPage />);
    await user.click(
      (await screen.findAllByRole('button', { name: /create export/i }))[0],
    );
    // Advance well past the 2s poll interval.
    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    // mockCloudFetch should have been called ONCE (the create), NOT N more
    // times for /status polls — that's the EC-15 invariant.
    const statusCalls = mockCloudFetch.mock.calls.filter((c) =>
      String(c[0] ?? '').includes('/status'),
    );
    expect(statusCalls.length).toBe(0);
  });
});
