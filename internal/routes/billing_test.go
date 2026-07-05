// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/usetheodev/theo-cloud/internal/auth"
)

// Plan release-blockers-2026-06-25-set T4.2 — closes theo-cloud#39.
//
// The Red Team flagged POST /v1/billing/checkout {plan:"pro"} returning
// 400 INVALID_PLAN with the self-contradicting message
// "Invalid plan. Available: pro, team". Root cause: PriceIDForPlan returns
// "" when STRIPE_PRICE_PRO env var is unset (dev-public config gap) — the
// handler collapsed two distinct failure modes into one misleading error.
//
// The canonical distinction is:
//   - Plan name NOT in allow-list           → 400 INVALID_PLAN  (user error)
//   - Plan name valid but price NOT wired   → 503 BILLING_NOT_CONFIGURED
//     (operator action: set STRIPE_PRICE_<PLAN> env)

// helper: build a request with an authenticated user context.
func newCheckoutRequest(t *testing.T, plan string) *http.Request {
	t.Helper()
	body := strings.NewReader(`{"plan":"` + plan + `"}`)
	r := httptest.NewRequest(http.MethodPost, "/v1/billing/checkout", body)
	r.Header.Set("Content-Type", "application/json")
	// Attach an authenticated user via the canonical auth.GetUser context key.
	ctx := auth.WithUser(r.Context(), &auth.UserContext{
		Subject:  "user-test",
		Email:    "test@example.com",
		Name:     "Test User",
		TenantID: "tn-test",
	})
	return r.WithContext(ctx)
}

// helper: parse the {code, message} response body.
func decodeError(t *testing.T, w *httptest.ResponseRecorder) (string, string) {
	t.Helper()
	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	code, _ := body["code"].(string)
	msg, _ := body["message"].(string)
	return code, msg
}

// TestCheckout_InvalidPlanName_Returns400 — plan name "acme" is not in the
// canonical {starter, pro, team} allow-list → 400 INVALID_PLAN with a
// non-contradicting message listing only valid plan names.
func TestCheckout_InvalidPlanName_Returns400(t *testing.T) {
	// Arrange: env vars CAN be set (validity check runs first regardless).
	t.Setenv("STRIPE_PRICE_STARTER", "price_starter_test")
	t.Setenv("STRIPE_PRICE_PRO", "price_pro_test")
	t.Setenv("STRIPE_PRICE_TEAM", "price_team_test")

	h := &BillingHandler{}
	w := httptest.NewRecorder()
	r := newCheckoutRequest(t, "acme")

	// Act
	h.Checkout(w, r)

	// Assert
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 INVALID_PLAN", w.Code)
	}
	code, msg := decodeError(t, w)
	if code != "INVALID_PLAN" {
		t.Errorf("code = %q, want INVALID_PLAN", code)
	}
	// The message MUST NOT be self-contradicting (NOT list a plan and
	// reject it in the same sentence).
	if strings.Contains(strings.ToLower(msg), "acme") {
		t.Errorf("message %q must not echo the invalid input (recon vector)", msg)
	}
	// MUST list the canonical valid plans for actionable guidance.
	for _, want := range []string{"starter", "pro", "team"} {
		if !strings.Contains(strings.ToLower(msg), want) {
			t.Errorf("message %q must list canonical plan %q", msg, want)
		}
	}
}

// TestCheckout_ValidPlanUnpriced_Returns503BillingNotConfigured — plan name
// "pro" is canonical but STRIPE_PRICE_PRO is unset → 503 BILLING_NOT_CONFIGURED.
// This is the EXACT #39 Red Team scenario — the response must NOT be the
// self-contradicting 400 INVALID_PLAN.
func TestCheckout_ValidPlanUnpriced_Returns503BillingNotConfigured(t *testing.T) {
	// Arrange: explicitly unset the canonical Stripe env so PriceIDForPlan returns "".
	_ = os.Unsetenv("STRIPE_PRICE_STARTER")
	_ = os.Unsetenv("STRIPE_PRICE_PRO")
	_ = os.Unsetenv("STRIPE_PRICE_TEAM")

	h := &BillingHandler{}
	w := httptest.NewRecorder()
	r := newCheckoutRequest(t, "pro")

	// Act
	h.Checkout(w, r)

	// Assert: the m-37/Sprint-8 canonical "honest signal" — operator action
	// is distinct from user error.
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503 BILLING_NOT_CONFIGURED (got code path: %d)", w.Code, w.Code)
	}
	code, msg := decodeError(t, w)
	if code != "BILLING_NOT_CONFIGURED" {
		t.Errorf("code = %q, want BILLING_NOT_CONFIGURED", code)
	}
	// REGRESSION GUARD: the pre-fix self-contradicting message must NEVER
	// surface for a canonical plan name (the exact #39 root cause).
	if code == "INVALID_PLAN" {
		t.Fatalf("#39 regression: canonical plan name 'pro' must NOT emit INVALID_PLAN; got code=%q msg=%q", code, msg)
	}
	if strings.Contains(strings.ToLower(msg), "invalid plan") {
		t.Errorf("#39 regression: message must not say 'Invalid plan' for a valid plan name; got %q", msg)
	}
	// The message MUST be actionable for the user (escalate to support).
	if !strings.Contains(strings.ToLower(msg), "support") {
		t.Errorf("message %q should suggest contacting support (user action)", msg)
	}
}

// TestCheckout_ValidPlanPriced_NoBillingPath — plan name "pro" with the
// Stripe Price configured but provisioner/stripe nil → 503 BILLING_UNAVAILABLE
// (the pre-existing downstream branch). Guard that the new NOT_CONFIGURED
// check does NOT short-circuit the priced-but-unwired path.
func TestCheckout_ValidPlanPriced_NoBillingPath(t *testing.T) {
	t.Setenv("STRIPE_PRICE_PRO", "price_pro_test")

	h := &BillingHandler{} // provisioner + stripe nil
	w := httptest.NewRecorder()
	r := newCheckoutRequest(t, "pro")

	h.Checkout(w, r)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", w.Code)
	}
	code, _ := decodeError(t, w)
	if code != "BILLING_UNAVAILABLE" {
		t.Errorf("code = %q, want BILLING_UNAVAILABLE (priced, but provisioner unwired)", code)
	}
}

// Compile-time guard: ensure auth.WithUser exists with the expected signature.
// If this fails to build, the test helper above is using the wrong context key
// (would silently pass tests with anonymous user → AUTH_REQUIRED 401).
var _ = func() context.Context {
	return auth.WithUser(context.Background(), &auth.UserContext{})
}

// Red Team theo-cloud#42 closure: the billing usage map used to source
// every metric from `usage_records` (a counter feed). Stateful capacity
// metrics (seats) were always 0 even for accounts with members. The fix
// reads seats canonically from `tenant_members` so the dashboard shows
// the real owner-included headcount instead of a misleading 0.
func TestGetBilling_Seats_FromTenantMembers_RedTeam42(t *testing.T) {
	dbConn, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { _ = dbConn.Close() })

	// No active subscription → starter plan is the default.
	mock.ExpectQuery("SELECT plan, current_period_start, current_period_end, stripe_subscription_id, amount_minor, currency FROM subscriptions WHERE account_id = (SELECT account_id FROM tenants WHERE id = $1) AND status = 'active' LIMIT 1").
		WithArgs("tn-test").
		WillReturnError(sqlError())

	// usage_records empty (capacity metrics aren't there).
	mock.ExpectQuery("SELECT metric, COALESCE(SUM(quantity), 0) FROM usage_records WHERE tenant_id = $1 AND period_start >= $2 GROUP BY metric").
		WillReturnRows(sqlmock.NewRows([]string{"metric", "quantity"}))

	// tenant_members has the owner → seats=1.
	mock.ExpectQuery("SELECT COUNT(*) FROM tenant_members WHERE tenant_id = $1").
		WithArgs("tn-test").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	h := &BillingHandler{db: dbConn}
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/billing", nil)
	r = r.WithContext(auth.WithUser(r.Context(), &auth.UserContext{
		Subject:  "user-test",
		Email:    "test@example.com",
		TenantID: "tn-test",
	}))

	h.GetBilling(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var body struct {
		Usage map[string]struct {
			Used  int  `json:"used"`
			Limit *int `json:"limit"`
		} `json:"usage"`
	}
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	seats, ok := body.Usage["seats"]
	if !ok {
		t.Fatalf("Red Team #42: response MUST surface a 'seats' usage entry, got: %+v", body.Usage)
	}
	if seats.Used != 1 {
		t.Errorf("Red Team #42: want seats.used=1 (the owner), got %d", seats.Used)
	}
}

// sqlError is a small helper so we don't import database/sql twice.
func sqlError() error {
	return sql.ErrNoRows
}

// J-06 / MEET-2026-07-03-003 D1 Layer 2 — GET /v1/billing emits an additive
// nested `plan_price` observed from the subscriptions row (no Go price constant).
const subSelectWithSpend = "SELECT plan, current_period_start, current_period_end, stripe_subscription_id, amount_minor, currency FROM subscriptions WHERE account_id = (SELECT account_id FROM tenants WHERE id = $1) AND status = 'active' LIMIT 1"

func billingBoilerplateQueries(mock sqlmock.Sqlmock) {
	mock.ExpectQuery("SELECT metric, COALESCE(SUM(quantity), 0) FROM usage_records WHERE tenant_id = $1 AND period_start >= $2 GROUP BY metric").
		WillReturnRows(sqlmock.NewRows([]string{"metric", "quantity"}))
	mock.ExpectQuery("SELECT COUNT(*) FROM tenant_members WHERE tenant_id = $1").
		WithArgs("tn-test").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
}

func doGetBilling(t *testing.T, dbConn *sql.DB) map[string]json.RawMessage {
	t.Helper()
	h := &BillingHandler{db: dbConn}
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/billing", nil)
	r = r.WithContext(auth.WithUser(r.Context(), &auth.UserContext{Subject: "u", Email: "e@x.com", TenantID: "tn-test"}))
	h.GetBilling(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return m
}

func TestGetBilling_Pro_PlanPriceFromRow(t *testing.T) {
	dbConn, mock, _ := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	t.Cleanup(func() { _ = dbConn.Close() })
	mock.ExpectQuery(subSelectWithSpend).WithArgs("tn-test").
		WillReturnRows(sqlmock.NewRows([]string{"plan", "current_period_start", "current_period_end", "stripe_subscription_id", "amount_minor", "currency"}).
			AddRow("pro", nil, nil, "sub_1", int64(2900), "usd"))
	billingBoilerplateQueries(mock)
	m := doGetBilling(t, dbConn)
	raw, ok := m["plan_price"]
	if !ok {
		t.Fatalf("pro: plan_price MUST be present, got keys %v", keysOf(m))
	}
	var pp struct {
		AmountMinor int64  `json:"amount_minor"`
		Currency    string `json:"currency"`
		Interval    string `json:"interval"`
	}
	_ = json.Unmarshal(raw, &pp)
	if pp.AmountMinor != 2900 || pp.Currency != "usd" || pp.Interval != "month" {
		t.Errorf("pro: want {2900,usd,month}, got %+v", pp)
	}
}

func TestGetBilling_Starter_PlanPriceZeroPresent(t *testing.T) {
	dbConn, mock, _ := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	t.Cleanup(func() { _ = dbConn.Close() })
	// No active subscription row → starter default.
	mock.ExpectQuery(subSelectWithSpend).WithArgs("tn-test").WillReturnError(sql.ErrNoRows)
	billingBoilerplateQueries(mock)
	m := doGetBilling(t, dbConn)
	raw, ok := m["plan_price"]
	if !ok {
		t.Fatalf("starter: plan_price MUST be present (known $0), got keys %v", keysOf(m))
	}
	var pp struct {
		AmountMinor int64  `json:"amount_minor"`
		Currency    string `json:"currency"`
		Interval    string `json:"interval"`
	}
	_ = json.Unmarshal(raw, &pp)
	if pp.AmountMinor != 0 || pp.Currency != "usd" || pp.Interval != "month" {
		t.Errorf("starter: want {0,usd,month}, got %+v", pp)
	}
}

func TestGetBilling_Enterprise_PlanPriceOmitted(t *testing.T) {
	dbConn, mock, _ := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	t.Cleanup(func() { _ = dbConn.Close() })
	mock.ExpectQuery(subSelectWithSpend).WithArgs("tn-test").
		WillReturnRows(sqlmock.NewRows([]string{"plan", "current_period_start", "current_period_end", "stripe_subscription_id", "amount_minor", "currency"}).
			AddRow("enterprise", nil, nil, "sub_e", nil, nil))
	billingBoilerplateQueries(mock)
	m := doGetBilling(t, dbConn)
	if _, ok := m["plan_price"]; ok {
		t.Errorf("enterprise: plan_price MUST be omitted (no public price), got %s", string(m["plan_price"]))
	}
}

func TestGetBilling_ProNotYetPersisted_PlanPriceOmitted(t *testing.T) {
	dbConn, mock, _ := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	t.Cleanup(func() { _ = dbConn.Close() })
	// pro row but amount_minor NULL (webhook hasn't landed / pre-migration) → omit, never a fake $0.
	mock.ExpectQuery(subSelectWithSpend).WithArgs("tn-test").
		WillReturnRows(sqlmock.NewRows([]string{"plan", "current_period_start", "current_period_end", "stripe_subscription_id", "amount_minor", "currency"}).
			AddRow("pro", nil, nil, "sub_p", nil, nil))
	billingBoilerplateQueries(mock)
	m := doGetBilling(t, dbConn)
	if _, ok := m["plan_price"]; ok {
		t.Errorf("pro-not-yet-persisted: plan_price MUST be omitted (never a fake $0 for a paid plan)")
	}
}

func keysOf(m map[string]json.RawMessage) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	return ks
}
