// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FetchEventSource } from './fetch-event-source';
import type { StreamEndReason } from './stream-end-reason';

/**
 * B-160 · T1 — the transport reports WHY the stream ended.
 *
 * `readyState` is a state, and the defect is that one state now has several causes. When
 * the native EventSource was replaced (B-088), `CLOSED` stopped meaning "the browser gave
 * up on an HTTP error" and started meaning that OR "the server finished cleanly" — while
 * `use-sse-stream.ts:228` still read it as the former and cleared the application-wide JWT
 * on every clean end.
 *
 * The transport is the only layer that knows which branch it took. These tests pin that it
 * says so.
 */
function endReasonOf(setup: () => void): Promise<StreamEndReason | undefined> {
  return new Promise((resolve) => {
    let seen: StreamEndReason | undefined;
    const es = new FetchEventSource('/stream', { token: 't' });
    es.onerror = (e) => {
      seen = (e as unknown as { reason?: StreamEndReason }).reason;
      resolve(seen);
    };
    setup();
    setTimeout(() => resolve(seen), 60);
  });
}

describe('FetchEventSource — end reason', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports server-closed when the body ends without an error', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) },
    });
    await expect(endReasonOf(() => {})).resolves.toBe('server-closed');
  });

  it('reports http-error on a non-2xx', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, body: null });
    await expect(endReasonOf(() => {})).resolves.toBe('http-error');
  });

  it('reports network-error when the request itself throws', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(endReasonOf(() => {})).resolves.toBe('network-error');
  });
});
