//go:build e2e

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// M3 T4.1 — the V1 ship-criterion, proven against a fully-migrated real pg-cloud
// (migrations through 000044, so account_id is NOT NULL). One suite composes the
// whole account-level-tenancy story:
//
//  1. one Account owns TWO tenants;
//  2. the tenants are isolated — a credential whose Account does NOT own the
//     target tenant is rejected 403 with no mint (real ForwardAuthHandler, M1);
//  3. per-Account billing — both tenants resolve the SAME plan from the Account's
//     ONE subscription (M2 account-join);
//  4. legacy → 200: a session JWT minted before M3 (no account_id claim) still
//     authenticates (the additive-claim backward-compat M3 introduces; a
//     NULL-account *key* can no longer exist post-000044, see scenario 5);
//  5. NOT NULL holds; inserting tenants/loopruntime_api_keys with a NULL account_id is
//     rejected with SQLSTATE 23502 on account_id (M3);
//  6. the migration pre-flight guard RAISEs on a residual NULL (EC-5).
//
// Build-tagged e2e; run under -race:
//
//	E2E_PG_CLOUD_DSN=postgres://loopruntime:loopruntime@host/db?sslmode=disable \
//	  go test -tags=e2e -race ./tests/e2e/ -run ShipCriterionM3 -v
package e2e

import (
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	_ "github.com/jackc/pgx/v5/stdlib"
	theojwt "github.com/usetheoai/theo-contracts/jwt"

	"github.com/usetheoai/theo-cloud/internal/auth"
)

// assertNotNullViolation fails unless err is a Postgres not_null_violation
// (SQLSTATE 23502) on the named column — so the test proves the RIGHT constraint
// fired, not an incidental FK/typo error (false green).
func assertNotNullViolation(t *testing.T, err error, column string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected a NOT NULL violation on %q, got nil", column)
	}
	var pg *pgconn.PgError
	if !errors.As(err, &pg) {
		t.Fatalf("expected a *pgconn.PgError on %q, got %T: %v", column, err, err)
	}
	if pg.Code != "23502" {
		t.Fatalf("expected SQLSTATE 23502 (not_null_violation) on %q, got %s: %s", column, pg.Code, pg.Message)
	}
	if pg.ColumnName != column {
		t.Fatalf("NOT NULL violation on column %q, want %q", pg.ColumnName, column)
	}
}

func cleanupShip(t *testing.T, db *sql.DB, owners ...string) {
	t.Helper()
	for _, owner := range owners {
		for _, s := range []string{
			`DELETE FROM loopruntime_api_keys WHERE subject = $1`,
			`DELETE FROM usage_records WHERE tenant_id IN (SELECT id FROM tenants WHERE owner_id = $1)`,
			`DELETE FROM subscriptions WHERE account_id IN (SELECT id FROM accounts WHERE owner_id = $1)`,
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
}

// seedShipTenant inserts a tenant that belongs to accountID (account_id set — the
// post-000044 NOT NULL world).
func seedShipTenant(t *testing.T, db *sql.DB, tenantID, ownerID, accountID string) {
	t.Helper()
	if _, err := db.Exec(
		`INSERT INTO tenants (id, display_name, slug, owner_id, account_id, cell_id)
		 VALUES ($1, $1, $1, $2, $3, 'cell-1') ON CONFLICT (id) DO NOTHING`,
		tenantID, ownerID, accountID); err != nil {
		t.Fatalf("seed ship tenant %s: %v", tenantID, err)
	}
}

// TestShipCriterionM3 is the single V1 ship-criterion anchor scenario.
func TestShipCriterionM3(t *testing.T) {
	db := openM1DB(t) // reuses the E2E_PG_CLOUD_DSN opener (auto-skips when unset)

	const (
		ownerAcme   = "ship-acme-uid"
		ownerRival  = "ship-rival-uid"
		acme        = "acct-shipacme0000"
		rival       = "acct-shiprival000"
		tenant1     = "tn-ship-1"
		tenant2     = "tn-ship-2"
		tenantRival = "tn-ship-rival"
		plan        = "pro"
	)
	cleanupShip(t, db, ownerAcme, ownerRival)
	t.Cleanup(func() { cleanupShip(t, db, ownerAcme, ownerRival) })

	// --- seed: ACME owns tenant1 + tenant2; RIVAL owns tenantRival ---
	seedUser(t, db, ownerAcme, "acme@e2e.test")
	seedUser(t, db, ownerRival, "rival@e2e.test")
	seedAccount(t, db, acme, ownerAcme)
	seedAccount(t, db, rival, ownerRival)
	seedShipTenant(t, db, tenant1, ownerAcme, acme)
	seedShipTenant(t, db, tenant2, ownerAcme, acme)
	seedShipTenant(t, db, tenantRival, ownerRival, rival)
	// ONE subscription for the ACME Account (M2: account-scoped).
	if _, err := db.Exec(
		`INSERT INTO subscriptions (id, tenant_id, account_id, plan, status, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, 'active', now(), now()) ON CONFLICT (account_id) DO NOTHING`,
		"sub-"+acme, tenant1, acme, plan); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}
	if _, err := db.Exec(
		`INSERT INTO plan_limits (plan, metric, hard_limit, soft_limit)
		 VALUES ('pro','projects',3,NULL) ON CONFLICT DO NOTHING`); err != nil {
		t.Fatalf("seed plan_limits: %v", err)
	}

	// --- 1. one Account owns TWO tenants ---
	t.Run("AccountOwnsTwoTenants", func(t *testing.T) {
		var n int
		if err := db.QueryRow(`SELECT count(*) FROM tenants WHERE account_id = $1`, acme).Scan(&n); err != nil {
			t.Fatalf("count: %v", err)
		}
		if n != 2 {
			t.Fatalf("ACME account owns %d tenants, want 2", n)
		}
	})

	// --- 2. tenant isolation: ACME key authorizes ACME's tenant (200) but NOT
	//        RIVAL's tenant (403, no mint) — via the real ForwardAuthHandler ---
	t.Run("CrossAccountIsolation", func(t *testing.T) {
		// positive: ACME key for ACME's tenant1 → 200, minted workspace == tenant.
		okKey := seedAccountKey(t, db, ownerAcme, tenant1, sql.NullString{String: acme, Valid: true})
		cmOK := &captureMinter{}
		if rec := serveM1(t, m1Handler(t, db, cmOK), okKey); rec.Code != http.StatusOK {
			t.Fatalf("ACME key for its own tenant: want 200, got %d", rec.Code)
		}
		if cmOK.workspace() != tenant1 {
			t.Fatalf("seam: minted workspace=%q, want tenant %q", cmOK.workspace(), tenant1)
		}
		// negative: ACME-account key pointed at RIVAL's tenant → 403, no mint.
		evilKey := seedAccountKey(t, db, "ship-acme-evil", tenantRival, sql.NullString{String: acme, Valid: true})
		t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM loopruntime_api_keys WHERE subject = $1`, "ship-acme-evil") })
		cmEvil := &captureMinter{}
		rec := serveM1(t, m1Handler(t, db, cmEvil), evilKey)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("cross-account credential: want 403, got %d", rec.Code)
		}
		if cmEvil.workspace() != "" {
			t.Fatalf("cross-account credential minted workspace=%q — must be no mint", cmEvil.workspace())
		}
	})

	// --- 3. per-Account billing: both tenants resolve the SAME plan from ONE sub ---
	t.Run("PerAccountBilling", func(t *testing.T) {
		var p1, p2 string
		if err := db.QueryRow(accountPlanQuery, tenant1).Scan(&p1); err != nil {
			t.Fatalf("plan for tenant1: %v", err)
		}
		if err := db.QueryRow(accountPlanQuery, tenant2).Scan(&p2); err != nil {
			t.Fatalf("plan for tenant2: %v", err)
		}
		if p1 != plan || p2 != plan {
			t.Fatalf("tenant plans (%q,%q) — both must resolve the Account's %q via the account join", p1, p2, plan)
		}
		var subs int
		if err := db.QueryRow(`SELECT count(*) FROM subscriptions WHERE account_id = $1`, acme).Scan(&subs); err != nil {
			t.Fatalf("count subs: %v", err)
		}
		if subs != 1 {
			t.Fatalf("ACME has %d subscriptions, want exactly 1 (per-Account)", subs)
		}
	})

	// --- 4. legacy → 200 (backward-compat). M3 makes loopruntime_api_keys.account_id
	//        NOT NULL, so a NULL-account *key* can no longer exist (scenario 5
	//        proves the same NOT NULL on tenants). The backward-compat surface M3
	//        actually introduces is the additive JWT claim: a session token minted
	//        BEFORE M3 (no account_id claim) must still authenticate 200. Prove it
	//        through the real RequireJWT middleware. ---
	t.Run("LegacyJWTWithoutAccountID_200", func(t *testing.T) {
		const secret = "ship-criterion-secret-32-bytes!!"
		issuer := theojwt.NewSessionTokenIssuer(secret, "theo-cloud", "theo-cloud", time.Hour)
		// A pre-M3 token: minted with an empty account_id, so the claim is omitted.
		legacyToken, _, err := issuer.Issue("ship-legacy-sub", "legacy@e2e.test", "L", tenant1, "")
		if err != nil {
			t.Fatalf("Issue legacy token: %v", err)
		}
		var ctxAccount = "sentinel"
		inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if u := auth.GetUser(r.Context()); u != nil {
				ctxAccount = u.AccountID
			}
			w.WriteHeader(http.StatusOK)
		})
		mw := auth.RequireJWT(nil, issuer)(inner)
		req := httptest.NewRequest(http.MethodGet, "/v1/anything", nil)
		req.Header.Set("Authorization", "Bearer "+legacyToken)
		rec := httptest.NewRecorder()
		mw.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("legacy session JWT (no account_id claim): want 200, got %d", rec.Code)
		}
		if ctxAccount != "" {
			t.Fatalf("legacy token AccountID = %q, want empty (additive claim)", ctxAccount)
		}
	})

	// --- 5. NOT NULL holds: a tenant with NULL account_id is rejected (M3 000044) ---
	t.Run("AccountIDNotNullEnforced", func(t *testing.T) {
		// tenants.account_id NOT NULL — assert the SPECIFIC constraint (23502 on
		// account_id), not just "some error" (which an FK/typo could fake).
		_, errT := db.Exec(
			`INSERT INTO tenants (id, display_name, slug, owner_id, account_id, cell_id)
			 VALUES ('tn-ship-null', 'N', 'tn-ship-null', $1, NULL, 'cell-1')`, ownerAcme)
		if errT == nil {
			_, _ = db.Exec(`DELETE FROM tenants WHERE id = 'tn-ship-null'`)
		}
		assertNotNullViolation(t, errT, "account_id")

		// loopruntime_api_keys.account_id NOT NULL; the OTHER table 000044 enforces.
		_, errK := db.Exec(
			`INSERT INTO loopruntime_api_keys (id, subject, tenant_id, account_id, key_name, key_hash, key_prefix, scopes, expires_at, created_at)
			 VALUES ('key-ship-null', $1, $2, NULL, 'n', 'hash-ship-null', 'theo_live_', '["memory:read"]'::jsonb, NOW() + interval '1 hour', NOW())`,
			ownerAcme, tenant1)
		if errK == nil {
			_, _ = db.Exec(`DELETE FROM loopruntime_api_keys WHERE id = 'key-ship-null'`)
		}
		assertNotNullViolation(t, errK, "account_id")
	})

	// --- 6. the migration's PRE-FLIGHT GUARD fires on a residual NULL with the
	//        specific operator message (EC-5: a guard that never fires is untested).
	//        Run the exact guard logic from 000044 inside a rolled-back tx after
	//        seeding a NULL, so the assertion exercises the RAISE path, not just
	//        the column constraint. ---
	t.Run("PreflightGuardFiresOnResidualNull", func(t *testing.T) {
		tx, err := db.Begin()
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		defer func() { _ = tx.Rollback() }()

		if _, err := tx.Exec(`ALTER TABLE tenants ALTER COLUMN account_id DROP NOT NULL`); err != nil {
			t.Fatalf("drop not null (in tx): %v", err)
		}
		if _, err := tx.Exec(
			`INSERT INTO tenants (id, display_name, slug, owner_id, account_id, cell_id)
			 VALUES ('tn-ship-guard', 'G', 'tn-ship-guard', $1, NULL, 'cell-1')`, ownerAcme); err != nil {
			t.Fatalf("seed NULL tenant (in tx): %v", err)
		}
		// The exact pre-flight guard from migration 000044_*.up.sql.
		_, gerr := tx.Exec(`DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenants WHERE account_id IS NULL) THEN
    RAISE EXCEPTION 'tenants.account_id has NULLs — run the 000038 backfill before enforcing NOT NULL';
  END IF;
END $$;`)
		if gerr == nil {
			t.Fatal("pre-flight guard must RAISE on a residual NULL (EC-5)")
		}
		var pg *pgconn.PgError
		if !errors.As(gerr, &pg) || pg.Code != "P0001" {
			t.Fatalf("guard must raise a P0001 raise_exception, got %T %v", gerr, gerr)
		}
		// rolled back via defer — m2test stays NOT NULL + NULL-free.
	})
}
