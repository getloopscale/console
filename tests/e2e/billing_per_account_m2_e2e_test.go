//go:build e2e

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// M2 T4.1 — Billing per-Account, proven against real pg-cloud. Proves the
// per-Account billing model at the schema + resolution level: two tenants of one
// Account resolve the SAME plan from ONE subscription (the account-join the Go
// resolvers use verbatim), UNIQUE(account_id) enforces one subscription per
// Account, and the project cap resolves from the Account's plan. Build-tagged e2e:
//
//	E2E_PG_CLOUD_DSN=postgres://loop_runtime:loop_runtime@localhost:15432/m2test?sslmode=disable \
//	  go test -tags=e2e ./tests/e2e/ -run BillingPerAccountM2 -v
package e2e

import (
	"database/sql"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func openM2DB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := env(t, "E2E_PG_CLOUD_DSN", "")
	if dsn == "" {
		t.Skip("E2E_PG_CLOUD_DSN not set — skipping billing-per-account M2 e2e")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func cleanupM2(t *testing.T, db *sql.DB, owner string) {
	t.Helper()
	for _, s := range []string{
		`DELETE FROM usage_records WHERE tenant_id IN (SELECT id FROM tenants WHERE owner_id=$1)`,
		`DELETE FROM subscriptions WHERE account_id IN (SELECT id FROM accounts WHERE owner_id=$1)`,
		`DELETE FROM tenants WHERE owner_id=$1`,
		`DELETE FROM accounts WHERE owner_id=$1`,
		`DELETE FROM users WHERE id=$1`,
	} {
		if _, err := db.Exec(s, owner); err != nil {
			t.Fatalf("cleanup %q: %v", s, err)
		}
	}
}

// The exact account-join plan query the Go resolvers use (cost_aggregator.go /
// routes/billing.go) — resolve the Account's single subscription plan for ANY of
// its tenants.
const accountPlanQuery = `SELECT plan FROM subscriptions WHERE account_id = (SELECT account_id FROM tenants WHERE id = $1) AND status = 'active'`

func seedAccountWithTwoTenantsOneSub(t *testing.T, db *sql.DB, owner, acct, tn1, tn2, plan string) {
	t.Helper()
	cleanupM2(t, db, owner)
	mustExec := func(q string, a ...any) {
		if _, err := db.Exec(q, a...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}
	// plan_limits is reference data seeded by migration 000002 (excluded from the
	// schema-only clone) — seed the projects caps the cap-resolution scenario needs.
	mustExec(`INSERT INTO plan_limits (plan,metric,hard_limit,soft_limit) VALUES ('starter','projects',1,NULL),('pro','projects',3,NULL) ON CONFLICT DO NOTHING`)
	mustExec(`INSERT INTO users (id,email,display_name,username) VALUES ($1,$2,'O','o_'||$1)`, owner, owner+"@e2e.test")
	mustExec(`INSERT INTO accounts (id,display_name,plan,owner_id) VALUES ($1,'A',$2,$3)`, acct, plan, owner)
	mustExec(`INSERT INTO tenants (id,display_name,slug,owner_id,account_id,cell_id) VALUES ($1,'T1',$1,$2,$3,'cell-1')`, tn1, owner, acct)
	mustExec(`INSERT INTO tenants (id,display_name,slug,owner_id,account_id,cell_id) VALUES ($1,'T2',$1,$2,$3,'cell-1')`, tn2, owner, acct)
	// ONE subscription for the Account (account-scoped, UNIQUE(account_id)).
	mustExec(`INSERT INTO subscriptions (id,tenant_id,account_id,plan,status) VALUES ($1,$2,$3,$4,'active')`, "sub-"+acct, tn1, acct, plan)
}

// Scenario 1 — two tenants of one Account resolve the SAME plan from ONE subscription.
func TestBillingPerAccountM2_TwoTenantsResolveAccountPlan(t *testing.T) {
	db := openM2DB(t)
	const owner, acct, tn1, tn2 = "m2-uid", "acct-m2", "tn-m2-a", "tn-m2-b"
	seedAccountWithTwoTenantsOneSub(t, db, owner, acct, tn1, tn2, "pro")

	for _, ten := range []string{tn1, tn2} {
		var plan string
		if err := db.QueryRow(accountPlanQuery, ten).Scan(&plan); err != nil {
			t.Fatalf("resolve plan for %s: %v", ten, err)
		}
		if plan != "pro" {
			t.Fatalf("tenant %s resolved plan %q, want the Account's 'pro' (no subscription has this tenant_id — must resolve via the account join)", ten, plan)
		}
	}
}

// Scenario 2 — exactly ONE subscription per Account; a 2nd is rejected.
func TestBillingPerAccountM2_OneSubscriptionPerAccount(t *testing.T) {
	db := openM2DB(t)
	const owner, acct, tn1, tn2 = "m2-one-uid", "acct-m2one", "tn-m2one-a", "tn-m2one-b"
	seedAccountWithTwoTenantsOneSub(t, db, owner, acct, tn1, tn2, "starter")

	var n int
	if err := db.QueryRow(`SELECT count(*) FROM subscriptions WHERE account_id=$1`, acct).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("want exactly 1 subscription per account, got %d", n)
	}
	// A 2nd subscription for the same account must violate UNIQUE(account_id).
	_, err := db.Exec(`INSERT INTO subscriptions (id,tenant_id,account_id,plan,status) VALUES ('sub-dup',$1,$2,'starter','active')`, tn2, acct)
	if err == nil {
		t.Fatal("UNIQUE(account_id) must reject a 2nd subscription for the account")
	}
}

// Scenario 3 — the project cap resolves from the Account's plan (plan_limits),
// confirming the cap is per-Account via the account-scoped plan.
func TestBillingPerAccountM2_ProjectCapResolvesFromAccountPlan(t *testing.T) {
	db := openM2DB(t)
	const owner, acct, tn1, tn2 = "m2-cap-uid", "acct-m2cap", "tn-m2cap-a", "tn-m2cap-b"
	seedAccountWithTwoTenantsOneSub(t, db, owner, acct, tn1, tn2, "pro")

	// Resolve the cap the same way the platform would: 2nd tenant → account's plan
	// → plan_limits. Assert it equals a DIRECT lookup of the pro cap (so the test is
	// pinned to the real product seed, not a hardcoded magic number): the account
	// join must resolve the SAME plan a direct 'pro' lookup does.
	var capViaJoin sql.NullInt64
	q := `SELECT hard_limit FROM plan_limits WHERE plan = (` + accountPlanQuery + `) AND metric='projects'`
	if err := db.QueryRow(q, tn2).Scan(&capViaJoin); err != nil {
		t.Fatalf("resolve project cap for tenant %s: %v", tn2, err)
	}
	var capDirect sql.NullInt64
	if err := db.QueryRow(`SELECT hard_limit FROM plan_limits WHERE plan='pro' AND metric='projects'`).Scan(&capDirect); err != nil {
		t.Fatalf("direct pro cap lookup: %v", err)
	}
	if !capViaJoin.Valid {
		t.Fatal("project cap resolved via the account join is NULL — the join did not resolve the account's plan")
	}
	if capViaJoin.Int64 != capDirect.Int64 {
		t.Fatalf("cap via account join = %d, direct pro cap = %d — the 2nd tenant must resolve the account's pro plan", capViaJoin.Int64, capDirect.Int64)
	}
}

// The exact account-join the usage reporter (metering/reporter.go) drains by —
// a usage record resolves its subscription via tenant → account, NOT tenant_id,
// so a 2nd tenant of the Account (which owns no subscription) is still billed.
const reporterDrainJoin = `
SELECT ur.tenant_id, COALESCE(s.stripe_subscription_item_id,'')
FROM usage_records ur
JOIN tenants t ON t.id = ur.tenant_id
JOIN subscriptions s ON s.account_id = t.account_id
WHERE ur.reported_to_stripe = false AND ur.quantity > 0
ORDER BY ur.tenant_id`

// Scenario 4 — the usage reporter bills BOTH tenants of an Account from the ONE
// subscription. Regression guard for the under-billing bug: joining usage by
// tenant_id silently dropped the 2nd tenant's usage (it owns no subscription).
func TestBillingPerAccountM2_ReporterBillsAllTenantsOfAccount(t *testing.T) {
	db := openM2DB(t)
	const owner, acct, tn1, tn2 = "m2-rep-uid", "acct-m2rep", "tn-m2rep-a", "tn-m2rep-b"
	seedAccountWithTwoTenantsOneSub(t, db, owner, acct, tn1, tn2, "pro")
	// Link a Stripe subscription item so the reporter would actually report (not skip).
	if _, err := db.Exec(`UPDATE subscriptions SET stripe_subscription_item_id='si_m2rep' WHERE account_id=$1`, acct); err != nil {
		t.Fatalf("set item id: %v", err)
	}
	// Unreported usage for BOTH tenants of the account.
	for _, tn := range []string{tn1, tn2} {
		if _, err := db.Exec(
			`INSERT INTO usage_records (id,tenant_id,metric,quantity,period_start,period_end,reported_to_stripe)
			 VALUES ($1,$2,'memory_ops',5,now(),now(),false)`, "ur-"+tn, tn,
		); err != nil {
			t.Fatalf("seed usage %s: %v", tn, err)
		}
	}

	rows, err := db.Query(reporterDrainJoin)
	if err != nil {
		t.Fatalf("reporter drain join: %v", err)
	}
	defer func() { _ = rows.Close() }()
	got := map[string]string{}
	for rows.Next() {
		var tn, item string
		if err := rows.Scan(&tn, &item); err != nil {
			t.Fatalf("scan: %v", err)
		}
		got[tn] = item
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	// BOTH tenants resolved (the under-billing regression would drop tn2).
	for _, tn := range []string{tn1, tn2} {
		if got[tn] != "si_m2rep" {
			t.Fatalf("tenant %s usage not resolved to the account's subscription item (got %q) — under-billing regression", tn, got[tn])
		}
	}
	if len(got) != 2 {
		t.Fatalf("want both tenants' usage drained via the account join, got %d", len(got))
	}
}
