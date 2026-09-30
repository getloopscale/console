import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * B-145 / B-168 — a cancel the server REFUSED was reported as a cancel that worked.
 *
 * ## The defect
 *
 * `engineFetch` was called without `{ throwOnError: true }`, so `cloudFetch` RESOLVES `null` on a
 * non-2xx. A resolved promise is success to `useMutation`: `onSuccess` runs, both query keys are
 * invalidated, and the dialog closes telling the operator the build was cancelled.
 *
 * It was proven by contrast rather than by reasoning — the three sibling mutations in this same
 * directory all pass the flag, and each carries a comment naming this exact failure
 * (`use-environments.ts`, `use-rollback.ts`, `use-promote.ts`).
 *
 * Cancelling a build is destructive and the operator acts on the answer. Telling them it worked
 * when it did not is the most expensive thing this surface can do.
 *
 * ## Why this file did not exist before
 *
 * The item carries an `attempt_log`: three attempts were made and REVERTED rather than shipped
 * half-done. All three failed on the same obstacle — the mocked rejection surfaced as an
 * unhandled rejection that failed the run for a reason unrelated to what was being measured.
 * `mutateAsync().catch()` did not help; `mockImplementation` over `mockRejectedValue` did not
 * either.
 *
 * Neither guess was the problem. The working precedent is `hooks/projects/use-scale.test.tsx`
 * (same hook family, same assertion, green): the fix is the **`act` boundary**. Awaiting the
 * rejection INSIDE `await act(async () => { try { await … } catch {} })` makes the settle and the
 * re-render happen in the same flushed scope. A floating `.catch()` attaches a handler while
 * React's flush happens outside the act scope, so the rejection escapes — which is exactly what
 * was observed and misattributed to the mock and to the QueryClient.
 *
 * No `mutations` block, no logger (TanStack v5 removed it), no `onError` shim in production code.
 */

import { useCancelBuild } from './use-cancel-build';

/**
 * The network is mocked at `fetch`, NOT at `engineFetch`, and that choice is the whole test.
 *
 * Mocking `engineFetch` with `mockRejectedValue` makes it reject whether or not the flag is
 * passed, so the `isError` assertion would pass against the UNFIXED code — the inert shape
 * B-152/B-189 name, reappearing in the very test written to close a bug. Letting the real
 * `cloudFetch` run is what makes `{ throwOnError: true }` the difference between a rejection and
 * a resolved `null`.
 */
function respondeCom(statusDaChamada: number) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    // Um 204 NAO pode carregar corpo — construir um `Response` assim lanca, e a excecao chegaria
    // como "falha de rede", medindo outra coisa que nao o que este teste quer medir.
    if (statusDaChamada === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ code: 'BUILD_ALREADY_FINISHED' }), { status: statusDaChamada });
  });
}

function makeWrapper(): {
  wrapper: (props: { children: ReactNode }) => ReactElement;
  client: QueryClient;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, client };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCancelBuild', () => {
  it('ends in isError when the server refuses the cancel', async () => {
    respondeCom(409);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCancelBuild(), { wrapper });

    let capturado: unknown = null;
    await act(async () => {
      try {
        await result.current.mutateAsync('build-123');
      } catch (e) {
        capturado = e;
      }
    });

    expect(capturado).toBeInstanceOf(Error);
    await waitFor(() => { expect(result.current.isError).toBe(true); });
  });

  it('does NOT invalidate the build queries when the cancel was refused', async () => {
    // The behavioural half the item's DoD asks for, and the one a source-text assertion cannot
    // make: the pre-fix bug is precisely that `onSuccess` fired on a refusal, invalidating both
    // keys and repainting the list as though something had changed.
    respondeCom(409);

    const { wrapper, client } = makeWrapper();
    const invalidar = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCancelBuild(), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync('build-123');
      } catch {
        /* asserted above; here the point is the side effect that must NOT happen */
      }
    });

    expect(invalidar).not.toHaveBeenCalled();
  });

  it('still invalidates both query keys when the cancel WORKED', async () => {
    // The guard must not disable the mechanism it protects.
    respondeCom(204);

    const { wrapper, client } = makeWrapper();
    const invalidar = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCancelBuild(), { wrapper });

    await act(async () => { await result.current.mutateAsync('build-123'); });

    await waitFor(() => { expect(invalidar).toHaveBeenCalledTimes(2); });
  });

  it('encodes the build id rather than interpolating it raw', async () => {
    const espiao = respondeCom(204);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCancelBuild(), { wrapper });

    await act(async () => { await result.current.mutateAsync('a/b?c'); });

    const urls = espiao.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/api/v1/builds/a%2Fb%3Fc/cancel'))).toBe(true);
  });
});
