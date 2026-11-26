// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { ApiError } from '@/lib/http/api';
import { SessionPicker, ScopeSelect } from './scope-switcher';

/**
 * B-243 — the picker stated as fact that the user had recorded no sessions, when what
 * actually happened was that the request failed.
 *
 * `useSessionsQuery` is built with `throwOnError: true`, so a failed read leaves
 * `data === undefined`. `(sessions.data?.sessions ?? []).length === 0` turned that into an
 * empty list and the label read "No sessions recorded yet" — an assertion about the user's
 * data, made on the strength of a request nobody could complete.
 *
 * The two states ask opposite things of whoever is looking: "you have none" invites creating
 * one; "I could not read" invites retrying or checking the service.
 */

const mockCloudFetch = vi.fn();

vi.mock('@/lib/http/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/http/api')>();
  return { ...actual, cloudFetch: (...args: unknown[]) => mockCloudFetch(...args) };
});

beforeEach(() => {
  mockCloudFetch.mockReset();
});

describe('SessionPicker — absence and ignorance are different labels', () => {
  it('says there are no sessions when the read SUCCEEDED and returned none', async () => {
    mockCloudFetch.mockResolvedValue({ sessions: [] });

    render(<SessionPicker value="" onChange={() => undefined} />);

    expect(await screen.findByText(/no sessions recorded yet/i)).toBeInTheDocument();
  });

  it('does NOT claim there are no sessions when the read FAILED', async () => {
    mockCloudFetch.mockRejectedValue(new ApiError(500, undefined, 'upstream exploded'));

    render(<SessionPicker value="" onChange={() => undefined} />);

    // Asserted on the option that IS rendered, not on the absence of the other. The picker
    // always renders exactly one empty-value option, so its text is the whole claim — and a
    // regression puts the wrong sentence there rather than removing an element, which an
    // absence assertion could not see (src/lib/absence-assertion-ratchet.test.ts).
    // findByRole WAITS for this specific option, so the assertion lands on the settled
    // state. `findAllByRole` resolved on the first render — the pending one — which is how
    // the loading case below was discovered in the first place.
    expect(
      await screen.findByRole('option', { name: /could not read sessions/i }),
    ).toBeInTheDocument();
  });

  it('does NOT claim there are no sessions while the read is still in flight', async () => {
    // Found BY the error test above: `findByRole` resolved on the first render, which is the
    // pending one, and it read "No sessions recorded yet". `data === undefined` is the same
    // value while loading and after failing, so `?? []` made the picker assert absence twice
    // over — before there was anything to assert about.
    mockCloudFetch.mockReturnValue(new Promise(() => undefined));

    render(<SessionPicker value="" onChange={() => undefined} />);

    expect(
      await screen.findByRole('option', { name: /loading sessions/i }),
    ).toBeInTheDocument();
  });

  it('says the sessions could not be read, so the operator knows what to do next', async () => {
    mockCloudFetch.mockRejectedValue(new ApiError(500, undefined, 'upstream exploded'));

    render(<SessionPicker value="" onChange={() => undefined} />);

    expect(await screen.findByText(/could not read sessions/i)).toBeInTheDocument();
  });

  it('lists the sessions it did read', async () => {
    mockCloudFetch.mockResolvedValue({
      sessions: [{ session_id: 'sess-abc', memory_count: 4 }],
    });

    render(<SessionPicker value="" onChange={() => undefined} />);

    expect(
      await screen.findByRole('option', { name: /sess-abc · 4 memories/ }),
    ).toBeInTheDocument();
  });
});

describe('ScopeSelect — its empty label is a TIER, not an absence claim', () => {
  it('keeps saying "Global" when the read fails, because that option is always available', async () => {
    mockCloudFetch.mockRejectedValue(new ApiError(500, undefined, 'upstream exploded'));

    render(<ScopeSelect value="" onChange={() => undefined} />);

    // WAIT for the query to settle before asserting. `findByText` resolved on the first,
    // still-pending render, so this case never saw the failed read at all — a mutation that
    // made SessionSelectBase override the label on error survived it. The test advertised a
    // guarantee it did not provide, which is worse than a redundant test.
    await waitFor(() => {
      expect(mockCloudFetch).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // "Global — durable memory" asserts nothing about the user's data: it names the scope you
    // are in when no session is selected. A failed session read does not make it false, so it
    // must NOT be rewritten into an error the way SessionPicker's label is — which is exactly
    // what widening the fix into SessionSelectBase would do, taking away the only way back to
    // the global tier whenever the session list 500s.
    expect(await screen.findByText(/global — durable memory/i)).toBeInTheDocument();
  });
});
