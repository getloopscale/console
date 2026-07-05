// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/billing"
)

// J-13 (MEET-2026-07-03-004) — GetInvoices handler matrix. The Stripe call is
// isolated behind the invoiceLister seam so these are pure handler unit tests
// (no live Stripe). H4 (non-owner 403) is enforced at the ROUTE via
// auth.RequireRole("owner") and asserted by the wiring, not here.

const invoiceCustomerSQL = "SELECT stripe_customer_id FROM subscriptions WHERE account_id = (SELECT account_id FROM tenants WHERE id = $1) AND stripe_customer_id IS NOT NULL LIMIT 1"

type fakeInvoiceLister struct {
	invoices   []billing.Invoice
	err        error
	called     bool
	gotCustGiven string
}

func (f *fakeInvoiceLister) ListInvoices(ctx context.Context, customerID string) ([]billing.Invoice, error) {
	f.called = true
	f.gotCustGiven = customerID
	return f.invoices, f.err
}

func invoicesRequest(tenantID string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/v1/billing/invoices", nil)
	if tenantID != "" {
		r = r.WithContext(auth.WithUser(r.Context(), &auth.UserContext{
			Subject: "u", Email: "o@x.com", TenantID: tenantID,
		}))
	}
	return r
}

func decodeInvoices(t *testing.T, w *httptest.ResponseRecorder) []map[string]any {
	t.Helper()
	var body struct {
		Invoices []map[string]any `json:"invoices"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (body=%s)", err, w.Body.String())
	}
	return body.Invoices
}

// H5 — unauthenticated → 401.
func TestGetInvoices_Unauthenticated_401(t *testing.T) {
	h := &BillingHandler{}
	w := httptest.NewRecorder()
	h.GetInvoices(w, invoicesRequest(""))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("code = %d, want 401", w.Code)
	}
}

// H1 — owner + customer with invoices → 200 mapped list; the resolved
// customer id (server-side, never a client param) is handed to the lister.
func TestGetInvoices_Owner_ReturnsMappedList(t *testing.T) {
	dbConn, mock, _ := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	defer func() { _ = dbConn.Close() }()
	mock.ExpectQuery(invoiceCustomerSQL).WithArgs("tn-1").
		WillReturnRows(sqlmock.NewRows([]string{"stripe_customer_id"}).AddRow("cus_abc"))

	fake := &fakeInvoiceLister{invoices: []billing.Invoice{
		{ID: "in_1", Number: "THEO-1", AmountMinor: 2900, Currency: "USD", Status: "paid", HostedInvoiceURL: "https://x"},
	}}
	h := &BillingHandler{db: dbConn, invoices: fake}
	w := httptest.NewRecorder()
	h.GetInvoices(w, invoicesRequest("tn-1"))

	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", w.Code)
	}
	if fake.gotCustGiven != "cus_abc" {
		t.Errorf("lister got customer %q, want cus_abc (server-side resolved)", fake.gotCustGiven)
	}
	inv := decodeInvoices(t, w)
	if len(inv) != 1 || inv[0]["id"] != "in_1" {
		t.Fatalf("invoices = %+v, want 1 with id in_1", inv)
	}
	// amount_minor survives JSON as a number (integer), not a float string.
	if inv[0]["amount_minor"].(float64) != 2900 {
		t.Errorf("amount_minor = %v, want 2900", inv[0]["amount_minor"])
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store (D3 PII)", w.Header().Get("Cache-Control"))
	}
}

// H2 — no subscription row / no customer → empty 200, Stripe NEVER called
// (IDOR + fail-closed: never call Stripe with an empty customer).
func TestGetInvoices_NoCustomer_EmptyList(t *testing.T) {
	dbConn, mock, _ := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	defer func() { _ = dbConn.Close() }()
	mock.ExpectQuery(invoiceCustomerSQL).WithArgs("tn-1").
		WillReturnError(sql.ErrNoRows)

	fake := &fakeInvoiceLister{}
	h := &BillingHandler{db: dbConn, invoices: fake}
	w := httptest.NewRecorder()
	h.GetInvoices(w, invoicesRequest("tn-1"))

	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", w.Code)
	}
	if fake.called {
		t.Error("Stripe lister called with no customer — must fail closed to empty 200")
	}
	if got := decodeInvoices(t, w); len(got) != 0 {
		t.Errorf("invoices = %+v, want []", got)
	}
}

// IDOR guard — an empty-string customer (legacy empty AccountID class) must
// NOT reach Stripe; fail closed to empty 200.
func TestGetInvoices_EmptyCustomer_FailsClosed(t *testing.T) {
	dbConn, mock, _ := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	defer func() { _ = dbConn.Close() }()
	mock.ExpectQuery(invoiceCustomerSQL).WithArgs("tn-1").
		WillReturnRows(sqlmock.NewRows([]string{"stripe_customer_id"}).AddRow(""))

	fake := &fakeInvoiceLister{}
	h := &BillingHandler{db: dbConn, invoices: fake}
	w := httptest.NewRecorder()
	h.GetInvoices(w, invoicesRequest("tn-1"))

	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", w.Code)
	}
	if fake.called {
		t.Error("Stripe lister called with empty customer — IDOR fail-closed violated")
	}
}

// H6 — customer exists, zero invoices → empty 200 (distinct path from H2).
func TestGetInvoices_CustomerZeroInvoices_EmptyList(t *testing.T) {
	dbConn, mock, _ := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	defer func() { _ = dbConn.Close() }()
	mock.ExpectQuery(invoiceCustomerSQL).WithArgs("tn-1").
		WillReturnRows(sqlmock.NewRows([]string{"stripe_customer_id"}).AddRow("cus_abc"))

	fake := &fakeInvoiceLister{invoices: []billing.Invoice{}}
	h := &BillingHandler{db: dbConn, invoices: fake}
	w := httptest.NewRecorder()
	h.GetInvoices(w, invoicesRequest("tn-1"))

	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", w.Code)
	}
	if !fake.called {
		t.Error("Stripe lister NOT called though a customer exists")
	}
	if got := decodeInvoices(t, w); len(got) != 0 {
		t.Errorf("invoices = %+v, want []", got)
	}
}

// H3 — Stripe error → 502 typed, NEVER a silent empty 200.
func TestGetInvoices_StripeError_502(t *testing.T) {
	dbConn, mock, _ := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	defer func() { _ = dbConn.Close() }()
	mock.ExpectQuery(invoiceCustomerSQL).WithArgs("tn-1").
		WillReturnRows(sqlmock.NewRows([]string{"stripe_customer_id"}).AddRow("cus_abc"))

	fake := &fakeInvoiceLister{err: errors.New("payment service error (status 500)")}
	h := &BillingHandler{db: dbConn, invoices: fake}
	w := httptest.NewRecorder()
	h.GetInvoices(w, invoicesRequest("tn-1"))

	if w.Code != http.StatusBadGateway {
		t.Fatalf("code = %d, want 502", w.Code)
	}
	// Response body must NOT leak the customer id.
	if body := w.Body.String(); containsSub(body, "cus_abc") {
		t.Errorf("502 body leaks customer id: %s", body)
	}
}

func containsSub(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
