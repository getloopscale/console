// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package routes

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/getloopscale/loop-console/internal/auth"

	"github.com/getloopscale/loop-console/internal/billing"
	"github.com/getloopscale/loop-console/internal/metrics"
)

// B-256 — the emission sites that did not exist.
//
// `loopscale_billing_checkout_total` and `loopscale_webhook_events_total` were defined, registered, and
// incremented by nothing outside their own unit tests. A checkout that fails because Stripe is
// unconfigured produced a 503 to one operator and a flat zero on the dashboard everyone else
// reads. These tests are the third pillar of the wiring triad for those two counters: they fail
// if the handler stops emitting.

func TestCheckout_UnconfiguredBilling_EmitsAFailedCheckout(t *testing.T) {
	t.Setenv("STRIPE_PRICE_PRO", "price_pro_test")
	before := metrics.CounterValue("loopscale_billing_checkout_total", "error")

	h := &BillingHandler{} // provisioner + stripe nil -> 503 BILLING_UNAVAILABLE
	w := httptest.NewRecorder()
	h.Checkout(w, newCheckoutRequest(t, "pro"))

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 (the fixture must reach the unconfigured branch)", w.Code)
	}
	if got := metrics.CounterValue("loopscale_billing_checkout_total", "error"); got != before+1 {
		t.Errorf("checkout error counter = %v, want %v — the failure is invisible to ops", got, before+1)
	}
}

func TestCheckout_InvalidPlan_EmitsAFailedCheckout(t *testing.T) {
	before := metrics.CounterValue("loopscale_billing_checkout_total", "error")

	h := &BillingHandler{}
	w := httptest.NewRecorder()
	h.Checkout(w, newCheckoutRequest(t, "not-a-plan"))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if got := metrics.CounterValue("loopscale_billing_checkout_total", "error"); got != before+1 {
		t.Errorf("checkout error counter = %v, want %v", got, before+1)
	}
}

func TestCheckout_DoesNotEmitSuccessOnAFailure(t *testing.T) {
	// The discrimination that makes the two above mean something: a handler that incremented
	// unconditionally would satisfy them and report every refused checkout as a started one.
	before := metrics.CounterValue("loopscale_billing_checkout_total", "started")

	h := &BillingHandler{}
	w := httptest.NewRecorder()
	h.Checkout(w, newCheckoutRequest(t, "not-a-plan"))

	if got := metrics.CounterValue("loopscale_billing_checkout_total", "started"); got != before {
		t.Errorf("started counter moved on a refused checkout: %v -> %v", before, got)
	}
}

func TestWebhook_BadSignature_EmitsAFailedWebhook(t *testing.T) {
	before := metrics.CounterValue("loopscale_webhook_events_total", "failed")

	h := &BillingHandler{webhook: billing.NewWebhookHandler(nil, "whsec_test", billing.PlanConfig{}, nil)}
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/webhooks/stripe", strings.NewReader(`{"id":"evt_1"}`))
	r.Header.Set("Stripe-Signature", "t=1,v1=deadbeef")

	h.Webhook(w, r)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (the fixture must fail signature verification)", w.Code)
	}
	if got := metrics.CounterValue("loopscale_webhook_events_total", "failed"); got != before+1 {
		t.Errorf("webhook failed counter = %v, want %v — a forged webhook is silent", got, before+1)
	}
}

func TestGetBilling_NoActiveSubscription_EmitsTheFallback(t *testing.T) {
	// `loopscale_subscription_fallback_total` exists so an operator can see how often plan resolution
	// lands on `starter` because it could not find anything better. It was never emitted, so the
	// number was zero whether that happened never or on every request — and those are opposite
	// facts about a billing system.
	before := metrics.CounterValue("loopscale_subscription_fallback_total")

	dbConn, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { _ = dbConn.Close() })

	mock.ExpectQuery("SELECT plan, current_period_start, current_period_end, stripe_subscription_id, amount_minor, currency FROM subscriptions WHERE account_id = (SELECT account_id FROM tenants WHERE id = $1) AND status = 'active' LIMIT 1").
		WithArgs("tn-test").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT metric, COALESCE(SUM(quantity), 0) FROM usage_records WHERE tenant_id = $1 AND period_start >= $2 GROUP BY metric").
		WillReturnRows(sqlmock.NewRows([]string{"metric", "quantity"}))
	mock.ExpectQuery("SELECT COUNT(*) FROM tenant_members WHERE tenant_id = $1").
		WithArgs("tn-test").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	h := &BillingHandler{db: dbConn}
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/billing", nil)
	r = r.WithContext(auth.WithUser(r.Context(), &auth.UserContext{
		Subject: "user-test", Email: "test@example.com", TenantID: "tn-test",
	}))

	h.GetBilling(w, r)

	if got := metrics.CounterValue("loopscale_subscription_fallback_total"); got != before+1 {
		t.Errorf("subscription fallback = %v, want %v", got, before+1)
	}
}
