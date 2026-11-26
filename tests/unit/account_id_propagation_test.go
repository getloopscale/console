// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// M3 (account-level tenancy, Phase 2) — proves account_id propagates end-to-end
// through the dashboard JWT path:
//
//	T3.3 — the session-token Exchange handler mints a token carrying the
//	       provisioned Account's id.
//	T3.4 — RequireJWT surfaces account_id into UserContext, and a legacy token
//	       WITHOUT the claim still authenticates (additive, EC-4).
package unit

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	loopscalejwt "github.com/getloopscale/contracts/jwt"

	"github.com/getloopscale/loop-console/internal/auth"
	"github.com/getloopscale/loop-console/internal/routes"
)

// T3.3 — the Exchange handler passes the provisioned accountID to Issue, so the
// minted session token carries account_id.
func TestExchange_MintedToken_CarriesAccountID(t *testing.T) {
	const userID, wantTenant, wantAccount = "kratos-uid-acct", "tn-prop", "acct-prop00000000"

	cfg := mockKratosCfg{statusCode: 200, active: true}
	cfg.identity.ID = userID
	cfg.identity.Email = "prop@loopscale.dev"
	cfg.identity.Name = "Prop"
	kratos := newMockKratosServer(t, cfg)
	defer kratos.Close()

	// Provisioner backed by sqlmock: the fast path finds an existing tenant whose
	// account_id is wantAccount (the returning-user 99% case).
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	mock.ExpectQuery(`SELECT t\.id, t\.account_id, tm\.role FROM tenants t JOIN tenant_members tm`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "account_id", "role"}).AddRow(wantTenant, wantAccount, "owner"))

	issuer := loopscalejwt.NewSessionTokenIssuer("test-secret-at-least-32-bytes-long-ok!", "loop-console-test", "loop-runtime-engine", time.Hour)
	prov := auth.NewTenantProvisioner(db, slog.New(slog.NewTextHandler(httptest.NewRecorder().Body, nil)))
	handler := routes.NewSessionTokenHandler(issuer, prov, kratos.URL)

	w := postWithCookie(t, handler, map[string]string{"ory_kratos_session": "valid"})
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	claims, err := issuer.ValidateSession(resp.AccessToken)
	if err != nil {
		t.Fatalf("validate minted token: %v", err)
	}
	if claims.AccountID != wantAccount {
		t.Fatalf("minted token AccountID = %q, want %q — handler did not propagate account_id", claims.AccountID, wantAccount)
	}
	if claims.TenantID != wantTenant {
		t.Fatalf("minted token TenantID = %q, want %q", claims.TenantID, wantTenant)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

// T3.4 — RequireJWT surfaces account_id into UserContext for a token that carries
// it, and still authenticates a legacy token WITHOUT the claim (EC-4).
func TestRequireJWT_SurfacesAccountID_AdditiveLegacyCompat(t *testing.T) {
	issuer := loopscalejwt.NewSessionTokenIssuer("test-secret-at-least-32-bytes-long-ok!", "loop-console-test", "loop-runtime-engine", time.Hour)

	var seen *auth.UserContext
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = auth.GetUser(r.Context())
		w.WriteHeader(http.StatusOK)
	})
	mw := auth.RequireJWT(nil, issuer)(inner)

	run := func(token string) int {
		seen = nil
		req := httptest.NewRequest(http.MethodGet, "/v1/anything", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		mw.ServeHTTP(w, req)
		return w.Code
	}

	// (a) token WITH account_id → UserContext.AccountID populated.
	withAcct, _, err := issuer.Issue("u1", "u@e2e.test", "U", "tn-1", "acct-x")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if code := run(withAcct); code != http.StatusOK {
		t.Fatalf("account-bearing token: want 200, got %d", code)
	}
	if seen == nil || seen.AccountID != "acct-x" {
		t.Fatalf("UserContext.AccountID = %v, want acct-x", seen)
	}

	// (b) legacy token WITHOUT account_id → still 200, AccountID empty (additive).
	legacy, _, err := issuer.Issue("u1", "u@e2e.test", "U", "tn-1", "")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if code := run(legacy); code != http.StatusOK {
		t.Fatalf("legacy token (no account_id): want 200, got %d", code)
	}
	if seen == nil || seen.AccountID != "" {
		t.Fatalf("legacy token AccountID = %v, want empty", seen)
	}
}
