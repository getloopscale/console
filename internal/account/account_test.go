// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// M0 T2.1 — EnsureAccount find-or-create unit contract (sqlmock). The DB-level
// race-safety (two concurrent first-logins -> one account) is proven by the
// integration test in tests/e2e/account_m0_e2e_test.go under `go test -race`
// against real Postgres, since sqlmock cannot model an ON CONFLICT race.
package account

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func newMock(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db, mock
}

func TestEnsureAccount_ReturnsExistingWhenOwnerHasAccount(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery("SELECT id FROM accounts WHERE owner_id").
		WithArgs("usrA").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("acct-existing01"))

	got, err := EnsureAccount(context.Background(), db, "usrA", "a@x.io")
	if err != nil {
		t.Fatalf("want nil err, got %v", err)
	}
	if got != "acct-existing01" {
		t.Fatalf("want existing account id, got %q", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations (no INSERT should run): %v", err)
	}
}

func TestEnsureAccount_CreatesWhenAbsent(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery("SELECT id FROM accounts WHERE owner_id").
		WithArgs("usrNew").
		WillReturnError(sql.ErrNoRows)
	// INSERT ... ON CONFLICT ... RETURNING id is a query under sqlmock.
	mock.ExpectQuery("INSERT INTO accounts").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("acct-0123456789abcdef"))

	got, err := EnsureAccount(context.Background(), db, "usrNew", "new@x.io")
	if err != nil {
		t.Fatalf("want nil err, got %v", err)
	}
	if !regexp.MustCompile(`^acct-[0-9a-f]{16}$`).MatchString(got) {
		t.Fatalf("returned id is not acct-{16hex}: %q", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestEnsureAccount_PropagatesQueryError(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery("SELECT id FROM accounts WHERE owner_id").
		WillReturnError(errors.New("connection reset"))

	_, err := EnsureAccount(context.Background(), db, "usrA", "a@x.io")
	if err == nil {
		t.Fatalf("want wrapped query error, got nil")
	}
}

func TestEnsureAccount_RejectsEmptyOwner(t *testing.T) {
	db, _ := newMock(t)
	if _, err := EnsureAccount(context.Background(), db, "", "a@x.io"); err == nil {
		t.Fatalf("want error for empty ownerID")
	}
}
