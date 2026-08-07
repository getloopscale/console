import { Badge, Button, Card, Table } from '@usetheo/ui';
import { useInvoices } from '@/hooks/settings/use-invoices';
import { formatMinor } from '@/lib/money';
import { formatDate } from '@/lib/format';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'default'> = {
  paid: 'success',
  open: 'warning',
  void: 'destructive',
  uncollectible: 'destructive',
  draft: 'default',
};

/**
 * InvoicesCard — J-13 (MEET-2026-07-03-004). Owner-only billing history.
 *
 * A SEPARATE fetch (useInvoices) from the plan/usage cards, so a Stripe outage
 * degrades ONLY this card (failure isolation, F3). Non-owners get 403 and the
 * card is omitted entirely (F4). Money renders from integer minor units via
 * formatMinor (never a float). `hosted_invoice_url` opens the Stripe-hosted
 * invoice page (the PDF lives behind Stripe's own session — invoice_pdf is
 * never exposed by the API, per the D3 security veto).
 */
export function InvoicesCard() {
  const { invoices, loading, forbidden, error } = useInvoices();

  // Owner-only — a member gets 403; omit the card rather than showing an error.
  if (forbidden) return null;

  return (
    <Card>
      <Card.Header>
        <Card.Title asChild>
          <h2>Invoices</h2>
        </Card.Title>
        <Card.Description>Your billing history.</Card.Description>
      </Card.Header>
      <Card.Body className="p-0">
        {loading ? (
          <div className="p-6 text-body-sm text-muted-foreground" role="status">
            Loading invoices…
          </div>
        ) : error ? (
          <div className="p-6 text-body-sm text-destructive">
            Couldn&rsquo;t load invoices. Try again in a moment.
          </div>
        ) : invoices.length === 0 ? (
          <div className="p-6 text-body-sm text-muted-foreground">No invoices yet.</div>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Invoice</Table.HeaderCell>
                <Table.HeaderCell>Date</Table.HeaderCell>
                <Table.HeaderCell>Amount</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell align="right"> </Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {invoices.map((inv) => (
                <Table.Row key={inv.id}>
                  <Table.Cell>{inv.number || inv.id}</Table.Cell>
                  <Table.Cell>{formatDate(inv.created, 'relative')}</Table.Cell>
                  <Table.Cell>{formatMinor(inv.amount_minor, inv.currency)}</Table.Cell>
                  <Table.Cell>
                    <Badge variant={STATUS_VARIANT[inv.status] ?? 'default'}>{inv.status}</Badge>
                  </Table.Cell>
                  <Table.Cell align="right">
                    {inv.hosted_invoice_url ? (
                      <Button asChild variant="ghost" size="sm">
                        <a href={inv.hosted_invoice_url} target="_blank" rel="noopener noreferrer">
                          View invoice
                        </a>
                      </Button>
                    ) : null}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Card.Body>
    </Card>
  );
}
