// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// skills-cross-repo-sdk-symmetry (M3) — route-gating proof for the SDK-surface
// cross-repo flat skills list. cmd/main.go mounts
//
//	r.With(auth.RequireScope(db,"memory:read")).Get("/skills/all", memoryHandler.ListSkillsAll)
//
// The handler-level tests (memory_handlers_test.go) deliberately bypass the
// middleware ("RequireScope is plugged in main.go"), so the SDK acceptance
// criterion "403 without memory:read / 200 with it" was unproven for THIS
// handler+scope binding. These two cases close that gap deterministically with
// sqlmock (no running stack), mirroring scope_middleware_test.go. The real
// cmd/main.go mount is proven end-to-end by TestMemoryE2E_SkillsAllCrossRepo.
package unit

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"github.com/usetheoai/theo-cloud/internal/auth"
	"github.com/usetheoai/theo-cloud/internal/themory"
)

// 200 path: a theo_live_* key carrying memory:read reaches the handler, which
// passes the BARE authed subject (ignoring any ?subject) and returns the
// cross-repo rows with per-row repoId.
func TestMemorySkillsAllRoute_Ok_WithMemoryRead(t *testing.T) {
	keyIDSkills := chaveDeTeste("skills-all")
	db, mock := sqlmockSetup(t)
	h, fake := newMemoryHandler(t)
	fake.skillsAllResp = &themory.SkillsAllResult{
		Skills: []themory.SkillWithRepo{{Skill: themory.Skill{ID: "s1"}, RepoID: "repo-a"}},
		Total:  1,
	}
	mw := auth.RequireScope(db, "memory:read")

	secret := "theo_live_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd"
	mock.ExpectQuery("SELECT id, subject, tenant_id, account_id, scopes, expires_at FROM theo_api_keys").
		WithArgs(hashOf(secret)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "subject", "tenant_id", "account_id", "scopes", "expires_at"}).
			AddRow(keyIDSkills, "sub-xyz", "tenant-A", nil, []byte(`["memory:read"]`), nil))
	mock.ExpectExec("UPDATE theo_api_keys").
		WithArgs(keyIDSkills, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	req := httptest.NewRequest("GET", "/v1/memory/skills/all?subject=attacker-supplied&limit=25", nil)
	req.Header.Set("Authorization", "Bearer "+secret)
	rec := httptest.NewRecorder()
	mw(http.HandlerFunc(h.ListSkillsAll)).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 with memory:read, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"repoId":"repo-a"`) {
		t.Errorf("expected per-row repoId in body, got %s", rec.Body.String())
	}
	if fake.lastSkillsAllSubject != "sub-xyz" {
		t.Errorf("expected BARE authed subject 'sub-xyz' (query ?subject ignored), got %q", fake.lastSkillsAllSubject)
	}

	// Allow the async fire-and-forget last_used_at update to land before asserting.
	time.Sleep(50 * time.Millisecond)
	// M149/#405: o veredito do mock era DESCARTADO aqui. Com ele descartado, remover o registro de
	// uso de `lookupAPIKey` não fazia este teste falhar — a expectativa do UPDATE ficava decorativa.
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("expectativas do mock não cumpridas: %v", err)
	}
}

// 403 path: a key WITHOUT memory:read (only memory:write) is rejected by the
// middleware BEFORE the handler runs — the cross-repo list is never invoked.
func TestMemorySkillsAllRoute_Forbidden_WithoutMemoryRead(t *testing.T) {
	db, mock := sqlmockSetup(t)
	h, fake := newMemoryHandler(t)
	mw := auth.RequireScope(db, "memory:read")

	secret := "theo_live_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd"
	mock.ExpectQuery("SELECT id, subject, tenant_id, account_id, scopes, expires_at FROM theo_api_keys").
		WithArgs(hashOf(secret)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "subject", "tenant_id", "account_id", "scopes", "expires_at"}).
			AddRow("apk-skills-all-2", "sub-xyz", "tenant-A", nil, []byte(`["memory:write"]`), nil)) // no memory:read

	req := httptest.NewRequest("GET", "/v1/memory/skills/all", nil)
	req.Header.Set("Authorization", "Bearer "+secret)
	rec := httptest.NewRecorder()
	mw(http.HandlerFunc(h.ListSkillsAll)).ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 without memory:read, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "scope_required") {
		t.Errorf("expected scope_required error body, got %s", rec.Body.String())
	}
	if fake.lastSkillsAllSubject != "" {
		t.Error("handler MUST NOT be reached on a 403 (scope denied before delegation)")
	}
	// Deny path has no async UPDATE (it returns before the goroutine), so the SELECT
	// is the only expectation — assert it was met (deterministic; no race to swallow).
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet/unexpected sqlmock expectations on the 403 path: %v", err)
	}
}
