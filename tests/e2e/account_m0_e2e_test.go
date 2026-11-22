//go:build e2e

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// M0 T3.1 — Account foundation integration proof against real pg-cloud.
// Exercises the NEW Go code (internal/auth EnsureTenant + ResolveAPIKey, which
// calls internal/account EnsureAccount) directly against a Postgres at the M0
// schema (migrations 000034-000039 applied). Reuses the package harness
// (seedUser/seedTenant/seedAPIKey/env). Build-tagged `e2e`; run with -race:
//
//	E2E_PG_CLOUD_DSN=postgres://loopzero:loopzero@localhost:15432/m0test?sslmode=disable \
//	  go test -tags=e2e -race ./tests/e2e/ -run AccountM0 -v
package e2e

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/usetheoai/theo-cloud/internal/auth"
	"github.com/usetheoai/theo-cloud/internal/routes"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func openM0DB(t *testing.T) *sql.DB {
	t.Helper()
	pgDSN := env(t, "E2E_PG_CLOUD_DSN", "")
	if pgDSN == "" {
		t.Skip("E2E_PG_CLOUD_DSN not set — skipping account M0 e2e")
	}
	db, err := sql.Open("pgx", pgDSN)
	if err != nil {
		t.Fatalf("open cloud db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func quietProvisioner(db *sql.DB) *auth.TenantProvisioner {
	return auth.NewTenantProvisioner(db, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

// cleanupOwner removes any rows from a prior run so the test is idempotent.
// FK-safe order: keys/subscriptions/members -> tenants -> accounts -> users.
func cleanupOwner(t *testing.T, db *sql.DB, ownerID string) {
	t.Helper()
	stmts := []string{
		`DELETE FROM loopzero_api_keys WHERE subject = $1`,
		`DELETE FROM subscriptions WHERE tenant_id IN (SELECT id FROM tenants WHERE owner_id = $1)`,
		`DELETE FROM tenant_members WHERE user_id = $1`,
		`DELETE FROM tenants WHERE owner_id = $1`,
		`DELETE FROM accounts WHERE owner_id = $1`,
		`DELETE FROM users WHERE id = $1`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s, ownerID); err != nil {
			t.Fatalf("cleanup %q: %v", s, err)
		}
	}
}

// NOTE (M3): the former Scenario 1 — "legacy key (NULL account_id) still
// resolves, AccountID == ''" — was REMOVED. M3 migration 000044 makes
// loopzero_api_keys.account_id NOT NULL, so a NULL-account key can no longer exist in
// the database and this e2e could no longer seed the state it asserted. The
// defensive NULL-tolerant scan it exercised is schema-independent and stays
// covered at the unit layer:
// internal/auth/scope_resolve_test.go::TestResolveAPIKey_ToleratesNullAccountID.

// Scenario 2 — a new signup yields exactly ONE Account owning its tenant.
func TestAccountM0_NewSignupOneAccountOwnsTenant(t *testing.T) {
	db := openM0DB(t)
	const uid = "m0-signup-uid"
	cleanupOwner(t, db, uid)

	tenantID, _, _, err := quietProvisioner(db).EnsureTenant(context.Background(), uid, "m0-signup@e2e.test")
	if err != nil {
		t.Fatalf("EnsureTenant: %v", err)
	}

	var nAcc int
	if err := db.QueryRow(`SELECT count(*) FROM accounts WHERE owner_id=$1`, uid).Scan(&nAcc); err != nil {
		t.Fatalf("count accounts: %v", err)
	}
	if nAcc != 1 {
		t.Fatalf("want exactly 1 account for new owner, got %d", nAcc)
	}

	var tenantAcc, ownerAcc string
	if err := db.QueryRow(`SELECT account_id FROM tenants WHERE id=$1`, tenantID).Scan(&tenantAcc); err != nil {
		t.Fatalf("tenant account_id: %v", err)
	}
	if err := db.QueryRow(`SELECT id FROM accounts WHERE owner_id=$1`, uid).Scan(&ownerAcc); err != nil {
		t.Fatalf("owner account id: %v", err)
	}
	if tenantAcc == "" || tenantAcc != ownerAcc {
		t.Fatalf("tenant.account_id %q must equal owner's account %q", tenantAcc, ownerAcc)
	}
}

// HIGH-1 regression — a key minted through the REAL CreateKey handler inherits
// its tenant's Account, even though the RequireJWT UserContext carries NO
// AccountID in M0. Guards against new keys silently persisting account_id=NULL.
func TestAccountM0_NewKeyInheritsTenantAccount(t *testing.T) {
	db := openM0DB(t)
	const uid = "m0-keyacct-uid"
	cleanupOwner(t, db, uid)

	tenantID, _, _, err := quietProvisioner(db).EnsureTenant(context.Background(), uid, "m0-keyacct@e2e.test")
	if err != nil {
		t.Fatalf("EnsureTenant: %v", err)
	}
	var tenantAcc string
	if err := db.QueryRow(`SELECT account_id FROM tenants WHERE id=$1`, tenantID).Scan(&tenantAcc); err != nil {
		t.Fatalf("tenant account: %v", err)
	}
	if tenantAcc == "" {
		t.Fatalf("precondition failed: tenant has no account")
	}

	// Drive the real handler with a UserContext that has NO AccountID (the
	// RequireJWT path in M0). The key must STILL get the tenant's account.
	h := routes.NewAPIKeysHandler(db, slog.New(slog.NewTextHandler(io.Discard, nil)))
	req := httptest.NewRequest("POST", "/v1/api-keys", strings.NewReader(`{"name":"m0-key","scopes":["memory:read"]}`))
	req = req.WithContext(auth.WithUser(req.Context(), &auth.UserContext{Subject: uid, TenantID: tenantID, AccountID: ""}))
	rec := httptest.NewRecorder()
	h.CreateKey(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("CreateKey: want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var keyAcc sql.NullString
	if err := db.QueryRow(`SELECT account_id FROM loopzero_api_keys WHERE subject=$1 AND key_name='m0-key'`, uid).Scan(&keyAcc); err != nil {
		t.Fatalf("query created key: %v", err)
	}
	if !keyAcc.Valid || keyAcc.String != tenantAcc {
		t.Fatalf("new key account_id = %v; want tenant's account %q (derived from tenant, NOT empty user.AccountID)", keyAcc, tenantAcc)
	}
}

// Concurrency — N distinct concurrent signups => N accounts, each owning its tenant.
func TestAccountM0_ConcurrentSignupsDistinctAccounts(t *testing.T) {
	db := openM0DB(t)
	prov := quietProvisioner(db)
	const N = 6
	uids := make([]string, N)
	for i := range uids {
		uids[i] = fmt.Sprintf("m0-conc-%d", i)
		cleanupOwner(t, db, uids[i])
	}

	var wg sync.WaitGroup
	errs := make([]error, N)
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _, _, errs[i] = prov.EnsureTenant(context.Background(), uids[i], fmt.Sprintf("c%d@e2e.test", i))
		}(i)
	}
	wg.Wait()

	for i, e := range errs {
		if e != nil {
			t.Fatalf("concurrent signup %d failed: %v", i, e)
		}
	}
	for _, uid := range uids {
		var n int
		if err := db.QueryRow(`SELECT count(*) FROM accounts WHERE owner_id=$1`, uid).Scan(&n); err != nil {
			t.Fatalf("count: %v", err)
		}
		if n != 1 {
			t.Fatalf("owner %s: want 1 account, got %d", uid, n)
		}
	}
}

// Race — the same new subject logging in concurrently must converge on ONE
// account and ONE tenant (the ON CONFLICT(owner_id) + advisory-lock proof).
// This is the scenario single-thread TDD cannot catch; run under -race.
func TestAccountM0_ConcurrentSameSubjectSingleAccount(t *testing.T) {
	db := openM0DB(t)
	prov := quietProvisioner(db)
	const uid = "m0-race-uid"
	cleanupOwner(t, db, uid)

	const G = 8
	var wg sync.WaitGroup
	for i := 0; i < G; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, _, _ = prov.EnsureTenant(context.Background(), uid, "race@e2e.test")
		}()
	}
	wg.Wait()

	var nAcc, nTen int
	if err := db.QueryRow(`SELECT count(*) FROM accounts WHERE owner_id=$1`, uid).Scan(&nAcc); err != nil {
		t.Fatalf("count accounts: %v", err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM tenants WHERE owner_id=$1`, uid).Scan(&nTen); err != nil {
		t.Fatalf("count tenants: %v", err)
	}
	if nAcc != 1 {
		t.Fatalf("race: want exactly 1 account for same subject, got %d", nAcc)
	}
	if nTen != 1 {
		t.Fatalf("race: want exactly 1 tenant for same subject, got %d", nTen)
	}
}
