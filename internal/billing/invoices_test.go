package billing

import (
	"context"
	"net/http"
	"net/http/httptest"
	"time"

	"testing"
)

// J-13 (MEET-2026-07-03-004) adapter test: proves the REAL raw-HTTP parse of
// Stripe's invoices/list — integer minor-units (never float), Unix→ISO-8601
// conversion, total→amount_minor, currency upper, hosted_invoice_url passthrough,
// and the outbound request shape (customer + clamped limit). No live Stripe.
func TestListInvoices_ParsesStripeListAndMaps(t *testing.T) {
	var gotMethod, gotPath, gotCustomer, gotLimit, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotCustomer = r.URL.Query().Get("customer")
		gotLimit = r.URL.Query().Get("limit")
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"object": "list",
			"has_more": false,
			"data": [
				{
					"id": "in_123",
					"number": "LOOPSCALE-0001",
					"total": 2900,
					"currency": "usd",
					"status": "paid",
					"created": 1751365200,
					"period_start": 1751328000,
					"period_end": 1754006400,
					"hosted_invoice_url": "https://invoice.stripe.com/i/acct_x/test_abc",
					"invoice_pdf": "https://invoice.stripe.com/pdf/acct_x/test_abc"
				}
			]
		}`))
	}))
	defer srv.Close()

	c := NewStripeClientWithURL("sk_test_key", srv.URL)
	invs, err := c.ListInvoices(context.Background(), "cus_x")
	if err != nil {
		t.Fatalf("ListInvoices error: %v", err)
	}

	// Request shape: GET /invoices?customer=cus_x&limit=100 with Bearer auth.
	if gotMethod != http.MethodGet {
		t.Errorf("method = %q, want GET", gotMethod)
	}
	if gotPath != "/invoices" {
		t.Errorf("path = %q, want /invoices", gotPath)
	}
	if gotCustomer != "cus_x" {
		t.Errorf("customer = %q, want cus_x", gotCustomer)
	}
	if gotLimit != "100" {
		t.Errorf("limit = %q, want 100 (clamped server-side)", gotLimit)
	}
	if gotAuth != "Bearer sk_test_key" {
		t.Errorf("auth header = %q, want Bearer sk_test_key", gotAuth)
	}

	if len(invs) != 1 {
		t.Fatalf("got %d invoices, want 1", len(invs))
	}
	inv := invs[0]
	if inv.ID != "in_123" {
		t.Errorf("id = %q, want in_123", inv.ID)
	}
	if inv.Number != "LOOPSCALE-0001" {
		t.Errorf("number = %q, want LOOPSCALE-0001", inv.Number)
	}
	// amount_minor from Stripe `total` as an INTEGER (never float).
	if inv.AmountMinor != 2900 {
		t.Errorf("amount_minor = %d, want 2900", inv.AmountMinor)
	}
	// currency normalized to upper ISO-4217.
	if inv.Currency != "USD" {
		t.Errorf("currency = %q, want USD", inv.Currency)
	}
	if inv.Status != "paid" {
		t.Errorf("status = %q, want paid", inv.Status)
	}
	// Unix → ISO-8601 UTC conversion.
	wantCreated := time.Unix(1751365200, 0).UTC().Format(time.RFC3339)
	if inv.Created != wantCreated {
		t.Errorf("created = %q, want %q", inv.Created, wantCreated)
	}
	wantPeriodStart := time.Unix(1751328000, 0).UTC().Format(time.RFC3339)
	if inv.PeriodStart != wantPeriodStart {
		t.Errorf("period_start = %q, want %q", inv.PeriodStart, wantPeriodStart)
	}
	if inv.HostedInvoiceURL != "https://invoice.stripe.com/i/acct_x/test_abc" {
		t.Errorf("hosted_invoice_url = %q", inv.HostedInvoiceURL)
	}
}

// Stripe upstream failure surfaces as an error (handler maps to typed 502) —
// NEVER a silent empty list, and never leaks the Stripe error verbatim.
func TestListInvoices_UpstreamErrorIsScrubbed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"message":"stripe internal for cus_secret"}}`))
	}))
	defer srv.Close()

	c := NewStripeClientWithURL("sk_test_key", srv.URL)
	_, err := c.ListInvoices(context.Background(), "cus_x")
	if err == nil {
		t.Fatal("expected error on Stripe 5xx, got nil (silent empty list is forbidden)")
	}
	if got := err.Error(); containsAny(got, "cus_secret", "cus_x", "sk_test_key") {
		t.Errorf("error leaks sensitive detail: %q", got)
	}
}

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
	}
	return false
}
