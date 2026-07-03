// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/billing"
)

// UsageMetric represents a single usage metric with current value and limit.
// Limit is nil when the metric is unlimited for the plan.
type UsageMetric struct {
	Used  int  `json:"used"`
	Limit *int `json:"limit"` // nil = unlimited
}

// BillingHandler handles billing-related endpoints.
// All endpoints require JWT (validated by auth.RequireJWT middleware).
type BillingHandler struct {
	db          *sql.DB
	stripe      *billing.StripeClient
	webhook     *billing.WebhookHandler
	provisioner *billing.Provisioner
	returnURL   string
}

// NewBillingHandler creates billing route handlers.
func NewBillingHandler(db *sql.DB, stripe *billing.StripeClient, webhook *billing.WebhookHandler, provisioner *billing.Provisioner, returnURL string) *BillingHandler {
	return &BillingHandler{
		db:          db,
		stripe:      stripe,
		webhook:     webhook,
		provisioner: provisioner,
		returnURL:   returnURL,
	}
}

// GetBilling returns the current plan and usage for the authenticated user.
// GET /v1/billing
func (h *BillingHandler) GetBilling(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}

	tenantID := user.TenantID

	// Lazy provisioning: ensure starter plan exists for this tenant.
	// Failure is non-fatal (we fall back to reading the existing row / starter
	// defaults), but it MUST be observable — a silent DB failure here would leave
	// the tenant without a subscription row indefinitely (MEDIUM-002).
	if h.provisioner != nil {
		if err := h.provisioner.ProvisionStarter(r.Context(), user.Subject, user.Email, tenantID); err != nil {
			slog.Warn("lazy starter provisioning failed", "tenant", tenantID, "error", err)
		}
	}

	// Determine plan from DB (fallback to starter)
	plan := "starter"
	var periodStart, periodEnd *time.Time
	var subscriptionID string
	// J-06 D1: the Stripe-observed recurring plan price (persisted by the webhook).
	var amountMinor sql.NullInt64
	var currency sql.NullString
	if h.db != nil {
		var ps, pe sql.NullTime
		var sid sql.NullString
		err := h.db.QueryRowContext(r.Context(),
			// M2: resolve the Account's single subscription (one plan per account).
			// J-06 D1: amount_minor + currency observe the Stripe price (no Go constant).
			"SELECT plan, current_period_start, current_period_end, stripe_subscription_id, amount_minor, currency FROM subscriptions WHERE account_id = (SELECT account_id FROM tenants WHERE id = $1) AND status = 'active' LIMIT 1",
			tenantID,
		).Scan(&plan, &ps, &pe, &sid, &amountMinor, &currency)
		if err != nil {
			// No active subscription → starter is the correct default (free tier,
			// or account not yet provisioned). A real DB error is NOT that — surface
			// it so a transient outage does not silently downgrade a paid account.
			if !errors.Is(err, sql.ErrNoRows) {
				slog.Warn("resolve account plan failed — defaulting to starter", "tenant", tenantID, "error", err)
			}
			plan = "starter"
		}
		if ps.Valid {
			periodStart = &ps.Time
		}
		if pe.Valid {
			periodEnd = &pe.Time
		}
		if sid.Valid {
			subscriptionID = sid.String
		}
	}

	limits := h.getLimitsForPlan(r, plan)
	usage := h.getUsageForTenant(r, tenantID)

	usageResponse := make(map[string]UsageMetric)
	for metric, limit := range limits {
		used := usage[metric]
		usageResponse[metric] = UsageMetric{Used: used, Limit: limit}
	}
	// Ensure all usage metrics appear even without configured limits
	for metric, used := range usage {
		if _, ok := usageResponse[metric]; !ok {
			usageResponse[metric] = UsageMetric{Used: used, Limit: nil}
		}
	}

	resp := map[string]interface{}{
		"plan":  billing.PlanDisplayName(plan),
		"team":  tenantID,
		"usage": usageResponse,
	}
	if periodStart != nil {
		resp["period_start"] = periodStart.Format(time.RFC3339)
	}
	if periodEnd != nil {
		resp["period_end"] = periodEnd.Format(time.RFC3339)
	}
	if subscriptionID != "" {
		resp["subscription_id"] = subscriptionID
	}

	// J-06 D1: additive nested plan_price observed from the subscription row.
	// starter → known $0 (present); enterprise/unknown/not-yet-persisted (NULL
	// column, e.g. pre-migration or webhook not yet delivered) → OMITTED (never a
	// fabricated $0 for a paid plan). Honest name: it is the recurring list price,
	// not metered spend.
	switch {
	case plan == "starter":
		resp["plan_price"] = map[string]interface{}{"amount_minor": 0, "currency": "usd", "interval": "month"}
	case plan == "enterprise":
		// omit — no public price (sales-led)
	case amountMinor.Valid:
		cur := "usd"
		if currency.Valid && currency.String != "" {
			cur = currency.String
		}
		resp["plan_price"] = map[string]interface{}{"amount_minor": amountMinor.Int64, "currency": cur, "interval": "month"}
	default:
		// pro/team not-yet-persisted (amount_minor NULL) → omit
	}

	writeJSON(w, http.StatusOK, resp)
}

// Portal creates a Stripe Customer Portal session and returns the URL.
// GET /v1/billing/portal
func (h *BillingHandler) Portal(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}

	tenantID := user.TenantID

	// Billing not configured (e.g., dev without Stripe): return the dashboard
	// billing page so the UI still works.
	if h.provisioner == nil || h.stripe == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"url":     h.returnURL + "/billing",
			"message": "Manage your plan, payment methods, and billing history.",
		})
		return
	}

	// Billing IS configured: a Stripe failure must surface as an error, NOT a 200
	// with a non-portal URL (MEDIUM-002) — otherwise the user clicks a link that
	// isn't a real Stripe portal and nothing is logged/alerted.
	customerID, err := h.provisioner.EnsureStripeCustomer(r.Context(), tenantID, user.Email, user.Name)
	if err != nil || customerID == "" {
		slog.Warn("portal: ensure stripe customer failed", "tenant", tenantID, "error", err)
		writeError(w, http.StatusBadGateway, "BILLING_UNAVAILABLE", "Could not open the billing portal. Try again.")
		return
	}
	session, err := h.stripe.CreatePortalSession(customerID, h.returnURL+"/billing")
	if err != nil {
		slog.Warn("portal: create stripe portal session failed", "tenant", tenantID, "error", err)
		writeError(w, http.StatusBadGateway, "BILLING_UNAVAILABLE", "Could not open the billing portal. Try again.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"url":     session.URL,
		"message": "Manage your plan, payment methods, and billing history.",
	})
}

// Checkout creates a Stripe Checkout session for upgrading to a paid plan.
// POST /v1/billing/checkout  body: {"plan": "pro" | "team"}
func (h *BillingHandler) Checkout(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: theo login")
		return
	}

	var body struct {
		Plan string `json:"plan"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Plan == "" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Missing plan. Specify: pro or team")
		return
	}

	// Plan release-blockers-2026-06-25-set T4.2 — closes theo-cloud#39.
	// The Red Team flagged a self-contradicting "Invalid plan. Available:
	// pro, team" when the user sent the valid plan name "pro". Root cause:
	// PriceIDForPlan reads os.Getenv("STRIPE_PRICE_PRO") raw — when the
	// dev-public env var is unset (operator config gap), it returns "" →
	// the handler emits 400 INVALID_PLAN despite the plan name being
	// canonical. The fix distinguishes the two failure modes:
	//   1. plan name NOT in allow-list → 400 INVALID_PLAN (user error)
	//   2. plan name valid but price NOT configured → 503 BILLING_NOT_CONFIGURED
	//      (operator action: set STRIPE_PRICE_<PLAN> env + rollout-restart)
	if !billing.IsValidPlanName(body.Plan) {
		writeError(w, http.StatusBadRequest, "INVALID_PLAN", "Invalid plan. Available: starter, pro, team")
		return
	}

	priceID := billing.LoadPlanConfig().PriceIDForPlan(body.Plan)
	if priceID == "" {
		// Operator signal: the env var is the canonical lever per
		// internal/billing/plans.go LoadPlanConfig.
		slog.Warn("billing checkout: plan name valid but price not configured — operator must set STRIPE_PRICE_<PLAN> env",
			"plan", body.Plan,
			"tenant", user.TenantID,
		)
		writeError(w, http.StatusServiceUnavailable, "BILLING_NOT_CONFIGURED",
			"Plan '"+body.Plan+"' is not available for purchase yet. Please contact support.")
		return
	}

	if h.provisioner == nil || h.stripe == nil {
		writeError(w, http.StatusServiceUnavailable, "BILLING_UNAVAILABLE", "Billing is not configured.")
		return
	}

	customerID, err := h.provisioner.EnsureStripeCustomer(r.Context(), user.TenantID, user.Email, user.Name)
	if err != nil || customerID == "" {
		writeError(w, http.StatusInternalServerError, "BILLING_ERROR", "Failed to set up billing. Try again.")
		return
	}

	session, err := h.stripe.CreateCheckoutSession(
		customerID,
		priceID,
		h.returnURL+"/billing?success=true",
		h.returnURL+"/billing?canceled=true",
		user.TenantID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "CHECKOUT_ERROR", "Failed to create checkout. Try again.")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"url": session.URL,
	})
}

// Webhook handles incoming Stripe webhook events.
// POST /v1/webhooks/stripe — NO auth middleware (Stripe signs with its own secret).
func (h *BillingHandler) Webhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 65536))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Failed to read request body.")
		return
	}

	sig := r.Header.Get("Stripe-Signature")
	if err := billing.VerifySignature(body, sig, h.webhook.WebhookSecret()); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_SIGNATURE", "Invalid webhook signature.")
		return
	}

	var event billing.StripeEvent
	if err := json.Unmarshal(body, &event); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PAYLOAD", "Invalid webhook payload.")
		return
	}

	if err := h.webhook.ProcessEvent(event); err != nil {
		writeError(w, http.StatusInternalServerError, "PROCESSING_ERROR", "Failed to process webhook event.")
		return
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"received":true}`))
}

// getLimitsForPlan returns limits per metric. nil value = unlimited (§1.5).
func (h *BillingHandler) getLimitsForPlan(r *http.Request, plan string) map[string]*int {
	v := func(n int) *int { return &n }
	defaults := map[string]*int{
		"projects": v(2), "builds_per_month": v(100), "environments": v(1),
		"seats": v(1), "secrets_per_env": v(10), "services_per_project": v(3),
	}
	if h.db == nil {
		return defaults
	}

	rows, err := h.db.QueryContext(r.Context(),
		"SELECT metric, hard_limit FROM plan_limits WHERE plan = $1", plan)
	if err != nil {
		return defaults
	}
	defer func() { _ = rows.Close() }()

	result := make(map[string]*int)
	for rows.Next() {
		var metric string
		var limit sql.NullInt64
		if err := rows.Scan(&metric, &limit); err != nil {
			continue
		}
		if limit.Valid {
			val := int(limit.Int64)
			result[metric] = &val
		} else {
			result[metric] = nil // NULL = unlimited
		}
	}
	if err := rows.Err(); err != nil {
		return defaults
	}
	if len(result) == 0 {
		return defaults
	}
	return result
}

func (h *BillingHandler) getUsageForTenant(r *http.Request, tenantID string) map[string]int {
	if h.db == nil {
		return map[string]int{}
	}

	now := time.Now().UTC()
	periodStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)

	rows, err := h.db.QueryContext(r.Context(),
		"SELECT metric, COALESCE(SUM(quantity), 0) FROM usage_records WHERE tenant_id = $1 AND period_start >= $2 GROUP BY metric",
		tenantID, periodStart)
	if err != nil {
		return map[string]int{}
	}
	defer func() { _ = rows.Close() }()

	result := make(map[string]int)
	for rows.Next() {
		var metric string
		var qty int
		if err := rows.Scan(&metric, &qty); err != nil {
			continue
		}
		result[metric] = qty
	}
	if err := rows.Err(); err != nil {
		return map[string]int{}
	}

	// Red Team theo-cloud#42 closure: usage_records is an append-only
	// counter feed for usage-style metrics (build minutes, etc.). It is
	// the wrong source for STATEFUL capacity metrics — projects + seats
	// don't emit a +1 event per existence; they have a current count
	// you read at request time. Before this fix, the /billing page
	// showed Seats 0/3 for an account whose owner was demonstrably
	// signed in. Source the seats count from tenant_members
	// canonically.
	if seats, ok := h.countSeats(r.Context(), tenantID); ok {
		result["seats"] = seats
	}
	return result
}

// countSeats returns the canonical seat count for a tenant by querying
// the local tenant_members table (the same SoT the auth path reads). The
// boolean indicates whether the count was resolved cleanly — a DB error
// returns (0, false) so the caller can leave the value 0 instead of
// over-reporting.
func (h *BillingHandler) countSeats(ctx context.Context, tenantID string) (int, bool) {
	if h.db == nil {
		return 0, false
	}
	var n int
	err := h.db.QueryRowContext(
		ctx,
		"SELECT COUNT(*) FROM tenant_members WHERE tenant_id = $1",
		tenantID,
	).Scan(&n)
	if err != nil {
		slog.Warn("count seats failed", "tenant", tenantID, "error", err)
		return 0, false
	}
	return n, true
}
