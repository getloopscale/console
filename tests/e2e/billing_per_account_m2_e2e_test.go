//go:build e2e

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// M2 T4.1 — Billing per-Account, proven against real pg-cloud. Proves the
// per-Account billing model at the schema + resolution level: two tenants of one
// Account resolve the SAME plan from ONE subscription (the account-join the Go
// resolvers use verbatim), UNIQUE(account_id) enforces one subscription per
// Account, and the project cap resolves from the Account's plan. Build-tagged e2e:
//
//	E2E_PG_CLOUD_DSN=postgres://theo:theo@localhost:15432/m2test?sslmode=disable \
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

	// Resolve the cap the same way the platform would: account's plan → plan_limits.
	var cap sql.NullInt64
	q := `SELECT hard_limit FROM plan_limits WHERE plan = (` + accountPlanQuery + `) AND metric='projects'`
	if err := db.QueryRow(q, tn2).Scan(&cap); err != nil {
		t.Fatalf("resolve project cap for tenant %s: %v", tn2, err)
	}
	if !cap.Valid || cap.Int64 != 3 {
		t.Fatalf("pro account project cap = %v, want 3 (plan_limits pro/projects)", cap)
	}
}
