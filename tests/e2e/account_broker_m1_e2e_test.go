//go:build e2e

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// M1 T3.1 — Account-aware broker + ForwardAuth cross-account guard, proven against
// real pg-cloud. Drives the REAL ForwardAuthHandler (real auth.AccountOwnsTenant +
// a real themory.Broker fronting a capturing minter) so the ownership SQL, the
// 403/200/503 wiring, and the seam invariant (minted workspace_id == tenantID,
// account never crosses to the data-plane) all agree. Build-tagged e2e; run -race:
//
//	E2E_PG_CLOUD_DSN=postgres://loopzero:loopzero@localhost:15432/m0test?sslmode=disable \
//	  go test -tags=e2e -race ./tests/e2e/ -run AccountBrokerM1 -v
package e2e

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/usetheoai/theo-cloud/internal/auth"
	"github.com/usetheoai/theo-cloud/internal/routes"
	"github.com/usetheoai/theo-cloud/internal/themory"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// captureMinter records the workspaceID the broker mints against (it must stay
// == tenantID; the Account must NEVER reach the data-plane).
type captureMinter struct {
	mu            sync.Mutex
	lastWorkspace string
}

func (m *captureMinter) MintKey(_ context.Context, workspaceID, _ string, _ []string) (*themory.MintResult, error) {
	m.mu.Lock()
	m.lastWorkspace = workspaceID
	m.mu.Unlock()
	return &themory.MintResult{ID: "apk-" + workspaceID, Secret: "minted-" + workspaceID}, nil
}

func (m *captureMinter) workspace() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.lastWorkspace
}

func m1Handler(t *testing.T, db *sql.DB, cm *captureMinter) *routes.ForwardAuthHandler {
	t.Helper()
	b, err := themory.NewBroker(cm, 64, time.Hour, []string{"memory:read", "memory:write", "memory:delete"})
	if err != nil {
		t.Fatalf("NewBroker: %v", err)
	}
	return routes.NewForwardAuthHandler(
		func(ctx context.Context, raw string) (*auth.UserContext, []string, error) {
			return auth.ResolveAPIKey(ctx, db, raw)
		},
		b,
		func(ctx context.Context, accountID, tenantID string) (bool, error) {
			return auth.AccountOwnsTenant(ctx, db, accountID, tenantID)
		},
		"memory:read",
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
}

func serveM1(t *testing.T, h *routes.ForwardAuthHandler, bearer string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/internal/authz/forward", nil)
	req.Header.Set("Authorization", "Bearer "+bearer)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// seedAccount inserts an account owned by ownerID (M0 schema).
func seedAccount(t *testing.T, db *sql.DB, accountID, ownerID string) {
	t.Helper()
	if _, err := db.Exec(
		`INSERT INTO accounts (id, display_name, plan, owner_id, created_at, updated_at)
		 VALUES ($1, $1, 'starter', $2, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
		accountID, ownerID); err != nil {
		t.Fatalf("seed account %s: %v", accountID, err)
	}
}

// seedAccountKey inserts a theo_live_* key with an explicit account_id. Returns the bearer.
func seedAccountKey(t *testing.T, db *sql.DB, subject, tenant string, accountID sql.NullString) string {
	t.Helper()
	bearer := "theo_live_" + subject + "_m1_secret"
	sum := sha256.Sum256([]byte(bearer))
	keyHash := hex.EncodeToString(sum[:])
	if _, err := db.Exec(`
		INSERT INTO loopzero_api_keys
			(id, subject, tenant_id, account_id, key_name, key_hash, key_prefix, scopes, expires_at, created_at)
		VALUES ($1,$2,$3,$4,'m1',$5,'theo_live_',$6::jsonb, NOW() + interval '1 hour', NOW())
		ON CONFLICT (key_hash) DO NOTHING`,
		"m1-"+keyHash[:16], subject, tenant, accountID, keyHash, `["memory:read"]`); err != nil {
		t.Fatalf("seed account key for %s: %v", subject, err)
	}
	return bearer
}

func openM1DB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := env(t, "E2E_PG_CLOUD_DSN", "")
	if dsn == "" {
		t.Skip("E2E_PG_CLOUD_DSN not set — skipping account-broker M1 e2e")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func cleanupM1(t *testing.T, db *sql.DB, owner string) {
	t.Helper()
	for _, s := range []string{
		`DELETE FROM loopzero_api_keys WHERE subject = $1`,
		`DELETE FROM subscriptions WHERE tenant_id IN (SELECT id FROM tenants WHERE owner_id = $1)`,
		`DELETE FROM tenant_members WHERE user_id = $1`,
		`DELETE FROM tenants WHERE owner_id = $1`,
		`DELETE FROM accounts WHERE owner_id = $1`,
		`DELETE FROM users WHERE id = $1`,
	} {
		if _, err := db.Exec(s, owner); err != nil {
			t.Fatalf("cleanup %q: %v", s, err)
		}
	}
}

// Scenario 1 — an Account-aware key whose account owns the tenant → 200, and the
// broker minted against workspace_id == tenantID (NOT the account).
func TestAccountBrokerM1_AccountOwnsTenant_200_WorkspaceIsTenant(t *testing.T) {
	db := openM1DB(t)
	const owner, acct, ten = "m1-own-uid", "acct-m1own", "tn-m1own"
	cleanupM1(t, db, owner)
	seedUser(t, db, owner, "m1own@e2e.test")
	seedAccount(t, db, acct, owner)
	// tenant owned by acct
	if _, err := db.Exec(`INSERT INTO tenants (id,display_name,slug,owner_id,account_id,cell_id) VALUES ($1,'T','m1own',$2,$3,'cell-1')`, ten, owner, acct); err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	bearer := seedAccountKey(t, db, owner, ten, sql.NullString{String: acct, Valid: true})

	cm := &captureMinter{}
	rec := serveM1(t, m1Handler(t, db, cm), bearer)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 (account owns tenant), got %d", rec.Code)
	}
	if cm.workspace() != ten {
		t.Fatalf("seam violated: minted workspace_id=%q, want tenantID %q (account must NOT cross to the data-plane)", cm.workspace(), ten)
	}
}

// Scenario 2 — a credential whose account does NOT own the tenant → 403, no mint.
func TestAccountBrokerM1_CrossAccount_403_NoMint(t *testing.T) {
	db := openM1DB(t)
	const owner, acctA, acctEvil, ten = "m1-x-uid", "acct-m1A", "acct-m1evil", "tn-m1x"
	cleanupM1(t, db, owner)
	cleanupM1(t, db, "m1-evil-uid")
	seedUser(t, db, owner, "m1x@e2e.test")
	seedUser(t, db, "m1-evil-uid", "m1evil@e2e.test")
	seedAccount(t, db, acctA, owner)
	seedAccount(t, db, acctEvil, "m1-evil-uid")
	// tenant is owned by acctA, but the key claims acctEvil → cross-account.
	if _, err := db.Exec(`INSERT INTO tenants (id,display_name,slug,owner_id,account_id,cell_id) VALUES ($1,'T','m1x',$2,$3,'cell-1')`, ten, owner, acctA); err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	bearer := seedAccountKey(t, db, owner, ten, sql.NullString{String: acctEvil, Valid: true})

	cm := &captureMinter{}
	rec := serveM1(t, m1Handler(t, db, cm), bearer)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403 (cross-account), got %d", rec.Code)
	}
	if rec.Header().Get("Authorization") != "" {
		t.Fatal("cross-account deny must NOT set Authorization")
	}
	if cm.workspace() != "" {
		t.Fatalf("cross-account must NOT mint, but broker minted workspace %q", cm.workspace())
	}
}

// NOTE (M3): the former Scenario 3 — "legacy key (NULL account_id) skips the
// check → 200"; was REMOVED. M3 migration 000044 makes loopzero_api_keys.account_id
// (and tenants.account_id) NOT NULL, so a NULL-account key can no longer exist in
// the database and this e2e could no longer seed the state it asserted. The
// defensive empty-account skip branch it exercised is schema-independent and
// stays covered at the unit layer:
// internal/routes/forward_auth_test.go::TestForwardAuth_LegacyNullAccount_SkipsCheck_200.

// Concurrency — N distinct account-aware credentials drive ForwardAuth against
// real pg under -race; all 200, no data race.
func TestAccountBrokerM1_ConcurrentAccountAware_Race(t *testing.T) {
	db := openM1DB(t)
	const n = 6
	type cred struct{ bearer string }
	creds := make([]cred, n)
	for i := 0; i < n; i++ {
		owner := fmt.Sprintf("m1-cc-%d", i)
		acct := fmt.Sprintf("acct-cc-%d", i)
		ten := fmt.Sprintf("tn-cc-%d", i)
		cleanupM1(t, db, owner)
		seedUser(t, db, owner, owner+"@e2e.test")
		seedAccount(t, db, acct, owner)
		if _, err := db.Exec(`INSERT INTO tenants (id,display_name,slug,owner_id,account_id,cell_id) VALUES ($1,'T',$2,$3,$4,'cell-1')`, ten, "cc"+fmt.Sprint(i), owner, acct); err != nil {
			t.Fatalf("seed tenant cc-%d: %v", i, err)
		}
		creds[i].bearer = seedAccountKey(t, db, owner, ten, sql.NullString{String: acct, Valid: true})
	}

	var wg sync.WaitGroup
	wg.Add(n)
	codes := make([]int, n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			rec := serveM1(t, m1Handler(t, db, &captureMinter{}), creds[i].bearer)
			codes[i] = rec.Code
		}(i)
	}
	wg.Wait()
	for i, c := range codes {
		if c != http.StatusOK {
			t.Fatalf("concurrent cred %d got %d, want 200", i, c)
		}
	}
}
