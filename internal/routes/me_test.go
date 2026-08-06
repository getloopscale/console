// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/usetheoai/theo-cloud/internal/auth"
)

// M0 J-02 T1.2 — GET /v1/auth/me carries the tenant provisioning snapshot the
// register "completing" screen polls: `provisioning` (active|pending|unknown),
// `plan`, `subscription_status`. Derived from the subscriptions row that the
// after-registration bootstrap (ProvisionStarter) writes — its presence IS the
// "provisioning done" signal. The identity fields MUST always be returned; a
// billing-lookup failure degrades to provisioning:"unknown", never a 500.

const meSubQuery = "SELECT plan, status FROM subscriptions WHERE account_id = (SELECT account_id FROM tenants WHERE id = $1) ORDER BY created_at DESC LIMIT 1"

func meRequestForTenant(tenantID string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	return r.WithContext(auth.WithUser(r.Context(), &auth.UserContext{
		Subject: "user-1", Email: "a@b.com", Name: "A B", TenantID: tenantID,
	}))
}

// stubProvisioner records the lazy ProvisionStarter call and returns a canned
// error, so the /me lazy-provision branch is tested without a real DB INSERT.
type stubProvisioner struct {
	called bool
	err    error
}

func (s *stubProvisioner) ProvisionStarter(_ context.Context, _, _, _ string) error {
	s.called = true
	return s.err
}

func TestMe_Unauthenticated_Returns401(t *testing.T) {
	h := NewMeHandler(nil, nil)
	w := httptest.NewRecorder()
	h.Get(w, httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", w.Code)
	}
}

func TestMe_SubscriptionExists_ProvisioningActive(t *testing.T) {
	dbConn, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer func() { _ = dbConn.Close() }()
	mock.ExpectQuery(meSubQuery).WithArgs("tn-1").
		WillReturnRows(sqlmock.NewRows([]string{"plan", "status"}).AddRow("starter", "active"))

	w := httptest.NewRecorder()
	NewMeHandler(dbConn, nil).Get(w, meRequestForTenant("tn-1"))

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("json: %v", err)
	}
	if body["provisioning"] != "active" {
		t.Errorf("provisioning=%v, want active", body["provisioning"])
	}
	if body["plan"] != "starter" {
		t.Errorf("plan=%v, want starter", body["plan"])
	}
	if body["subscription_status"] != "active" {
		t.Errorf("subscription_status=%v, want active", body["subscription_status"])
	}
	if body["email"] != "a@b.com" || body["team"] != "tn-1" {
		t.Errorf("identity fields must be preserved, got %+v", body)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestMe_NoSubscription_ProvisioningPending(t *testing.T) {
	dbConn, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer func() { _ = dbConn.Close() }()
	mock.ExpectQuery(meSubQuery).WithArgs("tn-2").WillReturnError(sql.ErrNoRows)

	w := httptest.NewRecorder()
	NewMeHandler(dbConn, nil).Get(w, meRequestForTenant("tn-2"))

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["provisioning"] != "pending" {
		t.Errorf("provisioning=%v, want pending", body["provisioning"])
	}
	if _, ok := body["plan"]; ok {
		t.Errorf("plan must be absent while still provisioning, got %v", body["plan"])
	}
}

func TestMe_DBError_ProvisioningUnknown_Still200(t *testing.T) {
	dbConn, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer func() { _ = dbConn.Close() }()
	mock.ExpectQuery(meSubQuery).WithArgs("tn-3").WillReturnError(errors.New("db unreachable"))

	w := httptest.NewRecorder()
	NewMeHandler(dbConn, nil).Get(w, meRequestForTenant("tn-3"))

	if w.Code != http.StatusOK {
		t.Fatalf("identity endpoint must NOT 500 on a billing-lookup failure, got %d", w.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["provisioning"] != "unknown" {
		t.Errorf("provisioning=%v, want unknown (degraded)", body["provisioning"])
	}
	if body["email"] != "a@b.com" {
		t.Errorf("identity must survive a degraded billing lookup")
	}
}

func TestMe_NilDB_OmitsProvisioning(t *testing.T) {
	w := httptest.NewRecorder()
	NewMeHandler(nil, nil).Get(w, meRequestForTenant("tn-4"))

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if _, ok := body["provisioning"]; ok {
		t.Errorf("provisioning must be omitted when no DB is configured, got %v", body["provisioning"])
	}
	if body["email"] != "a@b.com" {
		t.Errorf("identity preserved without a DB")
	}
}

// M0 J-02 T1.3 — when no subscription exists yet, /me lazily creates the free
// starter plan (mirrors the /billing lazy-ensure). On success the poll resolves
// to active/starter immediately, so the register completing screen redirects on
// its first poll instead of hanging on "pending".
func TestMe_NoSubscription_LazyProvisionsStarter(t *testing.T) {
	dbConn, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer func() { _ = dbConn.Close() }()
	mock.ExpectQuery(meSubQuery).WithArgs("tn-5").WillReturnError(sql.ErrNoRows)
	prov := &stubProvisioner{}

	w := httptest.NewRecorder()
	NewMeHandler(dbConn, prov).Get(w, meRequestForTenant("tn-5"))

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	if !prov.called {
		t.Fatal("expected ProvisionStarter to be called on a missing subscription")
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["provisioning"] != "active" {
		t.Errorf("provisioning=%v, want active after lazy provision", body["provisioning"])
	}
	if body["plan"] != "starter" {
		t.Errorf("plan=%v, want starter", body["plan"])
	}
}

// If the lazy provision itself fails, stay pending so the next poll retries —
// never surface a hard error on the identity endpoint.
func TestMe_LazyProvisionFails_StaysPending(t *testing.T) {
	dbConn, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer func() { _ = dbConn.Close() }()
	mock.ExpectQuery(meSubQuery).WithArgs("tn-6").WillReturnError(sql.ErrNoRows)
	prov := &stubProvisioner{err: errors.New("insert failed")}

	w := httptest.NewRecorder()
	NewMeHandler(dbConn, prov).Get(w, meRequestForTenant("tn-6"))

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["provisioning"] != "pending" {
		t.Errorf("provisioning=%v, want pending (retry next poll)", body["provisioning"])
	}
}
