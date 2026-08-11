import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/render';

// importOriginal: só o HOOK é dublado. As constantes do módulo (o teto de
// histórico) atravessam reais — um teste que redeclara a constante afirmaria
// sobre um número que a tela não usa.
vi.mock('@/hooks/settings/use-invoices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/settings/use-invoices')>()),
  useInvoices: vi.fn(),
}));

import { InvoicesCard } from './invoices-card';
import { useInvoices } from '@/hooks/settings/use-invoices';

const mocked = vi.mocked(useInvoices);

function state(over: Partial<ReturnType<typeof useInvoices>>) {
  mocked.mockReturnValue({
    invoices: [],
    loading: false,
    forbidden: false,
    error: false,
    ...over,
  });
}

beforeEach(() => vi.clearAllMocks());

// J-13 (MEET-2026-07-03-004) invoice table states — F1..F4.
describe('InvoicesCard (J-13)', () => {
  it('F1 — renders invoice rows with formatted money + a View invoice link', () => {
    state({
      invoices: [
        {
          id: 'in_1',
          number: 'THEO-0001',
          amount_minor: 2900,
          currency: 'usd',
          status: 'paid',
          created: '2026-07-01T10:00:00Z',
          period_start: '2026-07-01T00:00:00Z',
          period_end: '2026-08-01T00:00:00Z',
          hosted_invoice_url: 'https://invoice.stripe.com/i/abc',
        },
      ],
    });
    render(<InvoicesCard />);
    expect(screen.getByText('THEO-0001')).toBeInTheDocument();
    // Money from integer minor units — 2900 → $29.00 (never a float artifact).
    expect(screen.getByText('$29.00')).toBeInTheDocument();
    expect(screen.getByText('paid')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /view invoice/i });
    expect(link).toHaveAttribute('href', 'https://invoice.stripe.com/i/abc');
  });

  it('F2 — empty state when there are no invoices', () => {
    state({ invoices: [] });
    render(<InvoicesCard />);
    expect(screen.getByText(/no invoices yet/i)).toBeInTheDocument();
  });

  it('F3 — isolated error state (the card renders an error, not a crash)', () => {
    state({ error: true });
    render(<InvoicesCard />);
    expect(screen.getByText(/couldn.t load invoices/i)).toBeInTheDocument();
    // No table is rendered on error.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('F4 — non-owner (403 forbidden) omits the card entirely', () => {
    state({ forbidden: true });
    render(<InvoicesCard />);
    // The card renders nothing of its own — no heading, no table, no states.
    expect(screen.queryByRole('heading', { name: /invoices/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(/no invoices yet/i)).not.toBeInTheDocument();
  });
});
