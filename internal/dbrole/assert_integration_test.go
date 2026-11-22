// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Boot guard for the control plane's database role.
//
// The engine audit of 2026-08-14 found a control that had reported green for
// five months while never running, over a property nobody had measured. These
// tests are written so that cannot happen here: they refuse to pass vacuously,
// and each one measures a role that actually exists in the database.
//
//	DATABASE_URL=postgres://loopzero:loopzero@localhost:55450/loopzero?sslmode=disable \
//	THEO_CLOUD_ROLE_URL=postgres://loopzero_cloud:cloud@localhost:55450/loopzero?sslmode=disable \
//	go test ./internal/dbrole/ -count=1 -v
package dbrole

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func open(t *testing.T, envVar, role string) (context.Context, *sql.DB) {
	t.Helper()
	dsn := os.Getenv(envVar)
	if dsn == "" {
		t.Skipf("%s not set — %s posture not measured", envVar, role)
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open %s: %v", role, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(func() { cancel(); _ = db.Close() })
	if err := db.PingContext(ctx); err != nil {
		t.Skipf("cannot reach the database as %s: %v", role, err)
	}
	return ctx, db
}

// TestGuard_RefusesOwner pins the state this whole change exists to leave
// behind: the control plane connecting as the table owner, which reads every
// tenant AND holds DDL over their data.
func TestGuard_RefusesOwner(t *testing.T) {
	ctx, db := open(t, "DATABASE_URL", "owner")

	posture, err := Measure(ctx, db)
	if err != nil {
		t.Fatalf("measure: %v", err)
	}
	if !posture.HoldsUnnamedPrivilege() {
		t.Skipf("DATABASE_URL is not a broad role (%s) — nothing to assert here", posture)
	}

	err = AssertControlPlaneRole(ctx, db)
	if err == nil {
		t.Fatalf("the guard accepted a role with an unnamed cross-tenant privilege (%s).\n"+
			"This is the configuration the control plane shipped with: every tenant readable, "+
			"and DDL over the policies that are supposed to constrain it.", posture)
	}
	if !strings.Contains(err.Error(), "refusing to serve") {
		t.Errorf("guard rejected the role but with an unexpected message: %v", err)
	}
	t.Logf("guard correctly refused: %s", posture)
}

// TestGuard_AcceptsNamedCloudRole is the positive control. Without it the suite
// could only show that the guard says no — not that the intended role gets
// through, which is the thing an operator actually depends on.
func TestGuard_AcceptsNamedCloudRole(t *testing.T) {
	ctx, db := open(t, "THEO_CLOUD_ROLE_URL", "loopzero_cloud")

	posture, err := Measure(ctx, db)
	if err != nil {
		t.Fatalf("measure: %v", err)
	}
	if posture.Superuser || posture.BypassRLS || posture.IsOwner {
		t.Fatalf("THEO_CLOUD_ROLE_URL must point at the non-owner `loopzero_cloud` role; got %s.\n"+
			"Measuring the guard against a broad role would make this test meaningless.", posture)
	}

	if err := AssertControlPlaneRole(ctx, db); err != nil {
		t.Errorf("the guard rejected the intended control-plane role: %v", err)
	}
}

// TestNamedRole_ReachesEveryTenant proves migration 000063 actually granted the
// reach it claims. A guard that admits `loopzero_cloud` while the role cannot read
// across tenants would trade a silent over-privilege for a silent outage — the
// control plane would boot and then serve empty account listings.
func TestNamedRole_ReachesEveryTenant(t *testing.T) {
	octx, owner := open(t, "DATABASE_URL", "owner")
	ctx, cloud := open(t, "THEO_CLOUD_ROLE_URL", "loopzero_cloud")

	const (
		userID = "cloudrole-user"
		acctID = "cloudrole-acct"
		cellID = "cell-cloudrole"
		tenA   = "cloudrole-tenant-a"
		tenB   = "cloudrole-tenant-b"
	)

	mustExec := func(what, q string, args ...any) {
		t.Helper()
		if _, err := owner.ExecContext(octx, q, args...); err != nil {
			t.Fatalf("seed %s: %v", what, err)
		}
	}
	mustExec("user", `INSERT INTO users (id, email, username) VALUES ($1, $1||'@example.test', $1)
	                  ON CONFLICT DO NOTHING`, userID)
	mustExec("account", `INSERT INTO accounts (id, display_name, owner_id) VALUES ($1, 'cloudrole', $2)
	                     ON CONFLICT DO NOTHING`, acctID, userID)
	mustExec("cell", `INSERT INTO cells (cell_id, display_name) VALUES ($1, 'cloudrole')
	                  ON CONFLICT DO NOTHING`, cellID)
	for _, tn := range []string{tenA, tenB} {
		mustExec("tenant", `INSERT INTO tenants (id, display_name, slug, owner_id, account_id, cell_id)
		                    VALUES ($1, $1, $1, $2, $3, $4) ON CONFLICT DO NOTHING`,
			tn, userID, acctID, cellID)
	}
	t.Cleanup(func() {
		cctx := context.Background()
		_, _ = owner.ExecContext(cctx, `DELETE FROM tenants WHERE id IN ($1, $2)`, tenA, tenB)
		_, _ = owner.ExecContext(cctx, `DELETE FROM cells WHERE cell_id = $1`, cellID)
		_, _ = owner.ExecContext(cctx, `DELETE FROM accounts WHERE id = $1`, acctID)
		_, _ = owner.ExecContext(cctx, `DELETE FROM users WHERE id = $1`, userID)
	})

	// No app.tenant_id is set: the control plane legitimately has no single
	// tenant when it lists an account's tenants.
	var seen int
	if err := cloud.QueryRowContext(ctx,
		`SELECT count(*) FROM tenants WHERE id IN ($1, $2)`, tenA, tenB,
	).Scan(&seen); err != nil {
		t.Fatalf("cross-tenant read as loopzero_cloud: %v", err)
	}
	if seen != 2 {
		t.Errorf("loopzero_cloud saw %d of 2 tenants without a tenant context; the "+
			"*_cloud_cross_tenant policies from migration 000063 are missing or wrong. "+
			"The control plane would boot and then serve empty listings.", seen)
	}
}

// TestNamedRole_HoldsNoDDL is the narrowing that justifies the whole change: the
// owner could rewrite the very policies meant to constrain it. `loopzero_cloud`
// cannot.
func TestNamedRole_HoldsNoDDL(t *testing.T) {
	ctx, cloud := open(t, "THEO_CLOUD_ROLE_URL", "loopzero_cloud")

	if _, err := cloud.ExecContext(ctx, `ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY`); err == nil {
		t.Error("loopzero_cloud was able to lift FORCE ROW LEVEL SECURITY; it holds DDL over a " +
			"tenant-scoped table, so the blast-radius reduction claimed by migration 000063 " +
			"does not hold")
	}
	if _, err := cloud.ExecContext(ctx, `DROP POLICY IF EXISTS tenants_self_isolation ON tenants`); err == nil {
		t.Error("loopzero_cloud was able to drop an isolation policy")
	}
}
