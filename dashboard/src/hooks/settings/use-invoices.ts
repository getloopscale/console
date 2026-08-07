import { useQuery } from '@tanstack/react-query';
import { cloudFetch, ApiError } from '@/lib/http/api';
import type { Invoice } from '@/lib/api/types';

/**
 * B-024 (classe) — faturas nascem uma por mes e nunca saem. Sem teto, a conta
 * de tres anos baixa 36 registros e a de dez baixa 120: o cliente mais antigo,
 * que e o que menos deveria sentir atrito, e o que paga mais caro.
 *
 * 24 = dois anos. Escolha, nao derivacao: cobre o horizonte fiscal que alguem
 * abre a tela para conferir. O card avisa quando bate o teto, entao a decisao
 * e visivel em vez de silenciosa.
 */
export const INVOICE_HISTORY_LIMIT = 24;

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
    queryKey: ['cloud', '/v1/billing/invoices'],
    queryFn: () =>
      cloudFetch<{ invoices: Invoice[] }>(
        `/v1/billing/invoices?limit=${INVOICE_HISTORY_LIMIT}`,
        {},
        { throwOnError: true },
      ),
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
