// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

//go:build integration

// Integration tests for the storage quota against a REAL Postgres. Run with:
//
//	STORAGE_TEST_DATABASE_URL=postgres://... go test -tags=integration ./internal/storage/...
//
// These prove what the unit tests cannot: that the pg_advisory_xact_lock actually
// serializes concurrent reserves so two uploads near the cap yield exactly one
// 402 (blueprint ADR D2 — money-adjacent invariant). Gated by build tag so
// `go test ./...` stays hermetic-green without a DB (testing.md § 2).
package storage

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"sync"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	url := os.Getenv("STORAGE_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("STORAGE_TEST_DATABASE_URL not set — skipping storage integration test")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.PingContext(context.Background()); err != nil {
		t.Fatalf("ping db: %v", err)
	}
	return db
}

func cleanTenant(t *testing.T, db *sql.DB, tenantID string) {
	t.Helper()
	if _, err := db.Exec(`DELETE FROM storage_objects WHERE tenant_id = $1`, tenantID); err != nil {
		t.Fatalf("clean tenant: %v", err)
	}
}

// TestReserve_ConcurrentUploadsNearCap proves the advisory lock serializes two
// concurrent reserves: with the tenant at cap-1MB, two concurrent 1MB reserves
// must yield EXACTLY one success and one 402.
func TestReserve_ConcurrentUploadsNearCap(t *testing.T) {
	db := openTestDB(t)
	defer db.Close()
	const tenant = "tn-storage-itest"
	cleanTenant(t, db, tenant)
	defer cleanTenant(t, db, tenant)

	store := NewPGStore(db)
	// Starter aggregate = 100MB. Pre-fill 99MB so only ONE more 1MB fits.
	if _, err := store.InsertPending(context.Background(), tenant, "seed", 99<<20, "bin"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	q := NewQuota(store, "starter")
	var wg sync.WaitGroup
	var mu sync.Mutex
	var successes, quota402 int
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			_, err := q.Reserve(context.Background(), tenant, "concurrent-"+string(rune('a'+n)), 1<<20, "bin")
			mu.Lock()
			defer mu.Unlock()
			var qe *QuotaExceededError
			switch {
			case err == nil:
				successes++
			case errors.As(err, &qe):
				quota402++
			default:
				t.Errorf("unexpected error: %v", err)
			}
		}(i)
	}
	wg.Wait()

	if successes != 1 || quota402 != 1 {
		t.Errorf("concurrent reserve near cap: successes=%d quota402=%d, want 1/1 (advisory lock must serialize)", successes, quota402)
	}
}
