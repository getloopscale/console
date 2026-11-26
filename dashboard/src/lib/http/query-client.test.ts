import { describe, it, expect, vi } from 'vitest';
import { queryClient, invalidate } from './query-client';
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/http/api';

describe('queryClient', () => {
  it('test_singleton_exports_queryClient', () => {
    expect(queryClient).toBeInstanceOf(QueryClient);
  });

  it('test_default_staleTime_60s', () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(60_000);
  });

  it('test_default_refetchOnWindowFocus_true', () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.refetchOnWindowFocus).toBe(true);
  });

  it('test_mutations_do_not_retry', () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.mutations?.retry).toBe(0);
  });

  it('test_invalidate_helper_calls_invalidateQueries', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    invalidate(['projects']);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['projects'] });
    spy.mockRestore();
  });

  // Red Team loop-console#93 absorption (2026-06-27): retry guard
  // regression-protectors. Cover the FAANG default — 4xx never retries,
  // 5xx + network retry once.
  describe('retryGuard (#93)', () => {
    function getRetry(): (failureCount: number, error: unknown) => boolean | number {
      const r = queryClient.getDefaultOptions().queries?.retry;
      if (typeof r !== 'function') {
        throw new Error('retry must be a function for the guard to work');
      }
      return r as (failureCount: number, error: unknown) => boolean | number;
    }

    it('test_404_api_error_returns_false_no_retry (#93)', () => {
      const retry = getRetry();
      expect(retry(0, new ApiError(404, undefined, 'project not found'))).toBe(false);
    });

    it('test_403_api_error_returns_false_no_retry (#93)', () => {
      const retry = getRetry();
      expect(retry(0, new ApiError(403, undefined, 'forbidden'))).toBe(false);
    });

    it('test_500_api_error_retries_once', () => {
      const retry = getRetry();
      expect(retry(0, new ApiError(500, undefined, 'server error'))).toBe(true);
      // Second attempt: failureCount=1 → returns false (only one retry).
      expect(retry(1, new ApiError(500, undefined, 'server error'))).toBe(false);
    });

    it('test_network_error_retries_once', () => {
      const retry = getRetry();
      const networkErr = new Error('Network request failed');
      expect(retry(0, networkErr)).toBe(true);
      expect(retry(1, networkErr)).toBe(false);
    });

    it('test_api_error_status_0_classified_as_network_retries', () => {
      // ApiError(status=0) is the network-failure shape (per cloudFetch);
      // it should retry like a generic network error, not skip like 4xx.
      const retry = getRetry();
      const netErr = new ApiError(0, undefined, 'network');
      expect(retry(0, netErr)).toBe(true);
    });
  });
});
