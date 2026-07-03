package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Invoice is the Theo wire shape for a Stripe invoice (MEET-2026-07-03-004 D1).
// Money is integer minor units + explicit currency (never float); timestamps are
// ISO-8601 UTC (matching the sibling GET /v1/billing period fields).
//
// invoice_pdf is INTENTIONALLY absent: D3 security veto — it is a bearer
// capability link to raw invoice PII with no re-auth. Only hosted_invoice_url
// (the Stripe-hosted, revocable page) is exposed.
type Invoice struct {
	ID               string `json:"id"`
	Number           string `json:"number"`
	AmountMinor      int64  `json:"amount_minor"` // from Stripe `total`, integer minor units
	Currency         string `json:"currency"`     // ISO-4217 upper
	Status           string `json:"status"`       // draft|open|paid|void|uncollectible
	Created          string `json:"created"`      // ISO-8601 UTC
	PeriodStart      string `json:"period_start"` // ISO-8601 UTC
	PeriodEnd        string `json:"period_end"`   // ISO-8601 UTC
	HostedInvoiceURL string `json:"hosted_invoice_url"`
}

// ListInvoices returns up to 100 most-recent invoices for a Stripe customer.
// The limit is clamped server-side (the client never controls it). The caller
// supplies the context carrying the outbound timeout (handler sets 5s).
func (c *StripeClient) ListInvoices(ctx context.Context, customerID string) ([]Invoice, error) {
	q := url.Values{}
	q.Set("customer", customerID)
	q.Set("limit", "100") // clamped — MEET D4; a monthly account takes 8+ years to exceed

	var raw struct {
		Data []struct {
			ID               string `json:"id"`
			Number           string `json:"number"`
			Total            int64  `json:"total"`
			Currency         string `json:"currency"`
			Status           string `json:"status"`
			Created          int64  `json:"created"`
			PeriodStart      int64  `json:"period_start"`
			PeriodEnd        int64  `json:"period_end"`
			HostedInvoiceURL string `json:"hosted_invoice_url"`
		} `json:"data"`
	}
	if err := c.get(ctx, "/invoices", q, &raw); err != nil {
		return nil, err
	}

	out := make([]Invoice, 0, len(raw.Data))
	for _, d := range raw.Data {
		out = append(out, Invoice{
			ID:               d.ID,
			Number:           d.Number,
			AmountMinor:      d.Total,
			Currency:         strings.ToUpper(d.Currency),
			Status:           d.Status,
			Created:          isoUTC(d.Created),
			PeriodStart:      isoUTC(d.PeriodStart),
			PeriodEnd:        isoUTC(d.PeriodEnd),
			HostedInvoiceURL: d.HostedInvoiceURL,
		})
	}
	return out, nil
}

// isoUTC converts a Stripe Unix timestamp to ISO-8601 UTC; 0 → "".
func isoUTC(unix int64) string {
	if unix == 0 {
		return ""
	}
	return time.Unix(unix, 0).UTC().Format(time.RFC3339)
}

// get performs an authenticated Stripe GET. Errors are SCRUBBED — the outbound
// URL (which carries customer=cus_…) and the Stripe error body (which embeds
// cus_…) are NEVER surfaced (MEET D3b log-scrub denylist).
func (c *StripeClient) get(ctx context.Context, path string, query url.Values, result interface{}) error {
	u := c.baseURL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return fmt.Errorf("payment service request failed")
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		// Do error may embed the request URL (customer id) — never surface it.
		return fmt.Errorf("payment service unreachable")
	}
	defer func() { _ = resp.Body.Close() }()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		// Stripe error body embeds account info — return status only.
		return fmt.Errorf("payment service error (status %d)", resp.StatusCode)
	}
	if result != nil {
		return json.Unmarshal(body, result)
	}
	return nil
}
