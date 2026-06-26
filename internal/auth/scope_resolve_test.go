// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// platform-api-gateway-edge-slice1 (M6) T0.1 — ResolveAPIKey is the inbound
// theo_live_* validation extracted from RequireScope (DRY, ADR D1) so the
// ForwardAuth authz endpoint reuses the same lookup. These tests pin the typed
// error contract the handler depends on, including the edge-case hardening
// (EC-1 db-error vs bad-key, EC-3 empty-tenant, EC-6 non-Bearer).

package auth

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func bearerOf(secret string) string { return "Bearer " + secret }

func newAuthMock(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db, mock
}

func TestResolveAPIKey_ValidKey_ReturnsUserAndScopes(t *testing.T) {
	db, mock := newAuthMock(t)
	rows := sqlmock.NewRows([]string{"id", "subject", "tenant_id", "scopes", "expires_at"}).
		AddRow("k1", "user-a", "tenant-a", []byte(`["memory:read","memory:write"]`), nil)
	mock.ExpectQuery("FROM theo_api_keys").WillReturnRows(rows)

	uc, scopes, err := ResolveAPIKey(context.Background(), db, bearerOf("theo_live_abc"))
	if err != nil {
		t.Fatalf("want nil err, got %v", err)
	}
	if uc == nil || uc.TenantID != "tenant-a" || uc.Subject != "user-a" {
		t.Fatalf("bad UserContext: %+v", uc)
	}
	if len(scopes) != 2 || scopes[0] != "memory:read" {
		t.Fatalf("bad scopes: %v", scopes)
	}
}

func TestResolveAPIKey_UnknownOrExpiredKey_ReturnsInvalidCredential(t *testing.T) {
	// The SQL filters `expires_at > NOW()`, so an expired key returns no row —
	// collapsed into ErrInvalidCredential exactly like an unknown key. By design
	// (existing RequireScope D5 invariant): no distinction prevents keyspace
	// probing (covers EC-5 boundary too — `== now` is excluded by `> NOW()`).
	db, mock := newAuthMock(t)
	mock.ExpectQuery("FROM theo_api_keys").WillReturnError(sql.ErrNoRows)

	_, _, err := ResolveAPIKey(context.Background(), db, bearerOf("theo_live_x"))
	if !errors.Is(err, ErrInvalidCredential) {
		t.Fatalf("want ErrInvalidCredential, got %v", err)
	}
}

func TestResolveAPIKey_DBError_ReturnsBackendUnavailable(t *testing.T) {
	// EC-1: a DB/infra error must NOT be reported as a bad key (401) — it is a
	// fail-closed backend-unavailable (503 at the handler), never ErrInvalidCredential.
	db, mock := newAuthMock(t)
	mock.ExpectQuery("FROM theo_api_keys").WillReturnError(errors.New("connection reset"))

	_, _, err := ResolveAPIKey(context.Background(), db, bearerOf("theo_live_x"))
	if !errors.Is(err, ErrBackendUnavailable) {
		t.Fatalf("want ErrBackendUnavailable, got %v", err)
	}
	if errors.Is(err, ErrInvalidCredential) {
		t.Fatalf("db error must NOT collapse to ErrInvalidCredential")
	}
}

func TestResolveAPIKey_EmptyTenant_ReturnsInvalid(t *testing.T) {
	// EC-3: a row with an empty tenant_id (data-integrity bug) must never yield
	// a UserContext with empty TenantID — that would reach the broker with an
	// empty tenant. Reject at the boundary.
	db, mock := newAuthMock(t)
	rows := sqlmock.NewRows([]string{"id", "subject", "tenant_id", "scopes", "expires_at"}).
		AddRow("k1", "user-a", "", []byte(`["memory:read"]`), nil)
	mock.ExpectQuery("FROM theo_api_keys").WillReturnRows(rows)

	_, _, err := ResolveAPIKey(context.Background(), db, bearerOf("theo_live_x"))
	if !errors.Is(err, ErrInvalidCredential) {
		t.Fatalf("want ErrInvalidCredential for empty tenant, got %v", err)
	}
}

func TestResolveAPIKey_NonBearerScheme_ReturnsInvalidCredential(t *testing.T) {
	// EC-6: a non-Bearer / non-theo_live_ scheme is rejected WITHOUT a DB hit
	// and WITHOUT a panic. sqlmock with no ExpectQuery asserts the DB is untouched.
	db, _ := newAuthMock(t)

	_, _, err := ResolveAPIKey(context.Background(), db, "Basic dXNlcjpwYXNz")
	if !errors.Is(err, ErrInvalidCredential) {
		t.Fatalf("want ErrInvalidCredential for non-Bearer, got %v", err)
	}
}

func TestResolveAPIKey_ScopesCorruption_ReturnsBackendUnavailable(t *testing.T) {
	// A corrupt scopes jsonb is a fail-closed backend condition (500/503), never
	// a silent downgrade to "missing scope".
	db, mock := newAuthMock(t)
	rows := sqlmock.NewRows([]string{"id", "subject", "tenant_id", "scopes", "expires_at"}).
		AddRow("k1", "user-a", "tenant-a", []byte(`not-json`), nil)
	mock.ExpectQuery("FROM theo_api_keys").WillReturnRows(rows)

	_, _, err := ResolveAPIKey(context.Background(), db, bearerOf("theo_live_x"))
	if !errors.Is(err, ErrBackendUnavailable) {
		t.Fatalf("want ErrBackendUnavailable for corrupt scopes, got %v", err)
	}
}
