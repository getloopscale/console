import { useQuery } from '@tanstack/react-query';
import { cloudFetch, ApiError } from '@/lib/api';
import type { Invoice } from '@/lib/api/types';

export interface UseInvoicesResult {
  invoices: Invoice[];
  loading: boolean;
  /** 403 — the caller is not the account owner; the table is hidden (F4). */
  forbidden: boolean;
  /** Non-403 failure (e.g. Stripe-down 502) — the table shows an isolated
   *  error state; the rest of the billing page keeps rendering (F3). */
  error: boolean;
}

/**
 * useInvoices — J-13 (MEET-2026-07-03-004). A SEPARATE fetch from
 * `/v1/billing`, so a Stripe outage degrades only the invoice table (failure
 * isolation). Owner-gated server-side → a member gets 403 (forbidden).
 */
export function useInvoices(): UseInvoicesResult {
  const q = useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: () =>
      cloudFetch<{ invoices: Invoice[] }>('/v1/billing/invoices', {}, { throwOnError: true }),
    // User-facing synchronous read — never hammer on a 4xx/5xx (F5); the
    // backend already fails fast.
    retry: false,
  });
  const status = q.error instanceof ApiError ? q.error.status : undefined;
  return {
    invoices: q.data?.invoices ?? [],
    loading: q.isLoading,
    forbidden: status === 403,
    error: q.isError && status !== 403,
  };
}
