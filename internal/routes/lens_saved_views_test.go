// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-chi/chi/v5"

	"github.com/usetheoai/theo-cloud/internal/auth"
)

// theo-lens M52 — LensSavedViewsHandler. Per-tenant saved trace-list filter combinations, mirroring
// the J-16 workspace_webhooks isolation (subject+tenant_id scoping, 404-not-403 cross-tenant delete).

func lsvReq(method, target, body, tenant string) *http.Request {
	var r *http.Request
	if body != "" {
		r = httptest.NewRequest(method, target, strings.NewReader(body))
	} else {
		r = httptest.NewRequest(method, target, nil)
	}
	if tenant != "" {
		r = r.WithContext(auth.WithUser(r.Context(), &auth.UserContext{
			Subject: "sub-1", Email: "o@x.com", TenantID: tenant,
		}))
	}
	return r
}

func TestLensSavedViews_Create_Unauthenticated_401(t *testing.T) {
	h := &LensSavedViewsHandler{}
	w := httptest.NewRecorder()
	h.Create(w, lsvReq(http.MethodPost, "/v1/dashboard/lens/saved-views", `{"name":"n","query_string":"?q=x"}`, ""))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("code = %d, want 401", w.Code)
	}
}

func TestLensSavedViews_Create_RejectsEmptyName(t *testing.T) {
	h := &LensSavedViewsHandler{}
	w := httptest.NewRecorder()
	h.Create(w, lsvReq(http.MethodPost, "/v1/dashboard/lens/saved-views", `{"name":"  ","query_string":"?q=x"}`, "tn-1"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 for empty name", w.Code)
	}
}

func TestLensSavedViews_Create_RejectsEmptyQuery(t *testing.T) {
	h := &LensSavedViewsHandler{}
	w := httptest.NewRecorder()
	h.Create(w, lsvReq(http.MethodPost, "/v1/dashboard/lens/saved-views", `{"name":"errors","query_string":""}`, "tn-1"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 for empty query_string", w.Code)
	}
}

func TestLensSavedViews_Create_InsertsAndReturnsID(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	mock.ExpectExec("INSERT INTO lens_saved_views").
		WillReturnResult(sqlmock.NewResult(0, 1))

	h := NewLensSavedViewsHandler(dbConn, nil)
	w := httptest.NewRecorder()
	h.Create(w, lsvReq(http.MethodPost, "/v1/dashboard/lens/saved-views",
		`{"name":"errored opus last 24h","query_string":"?status=error&model=claude-opus-4-8&range=24h"}`, "tn-1"))

	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200 (body=%s)", w.Code, w.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	id, _ := resp["id"].(string)
	if !strings.HasPrefix(id, "lsv-") {
		t.Errorf("id = %q, want lsv- prefix", id)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("sqlmock expectations: %v", err)
	}
}

func TestLensSavedViews_List_ScopedToSubjectAndTenant(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	mock.ExpectQuery("SELECT id, name, query_string, created_at").
		WithArgs("sub-1", "tn-1"). // the (subject, tenant_id) isolation binds here
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "query_string", "created_at"}).
			AddRow("lsv-0011223344556677", "errors", "?status=error", "2026-07-04T10:00:00Z"))

	h := NewLensSavedViewsHandler(dbConn, nil)
	w := httptest.NewRecorder()
	h.List(w, lsvReq(http.MethodGet, "/v1/dashboard/lens/saved-views", "", "tn-1"))

	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), "lsv-0011223344556677") {
		t.Errorf("list body missing the view: %s", w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("sqlmock expectations: %v", err)
	}
}

func TestLensSavedViews_Delete_NotFoundWhenZeroRows(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	// A cross-tenant / non-existent row → 0 rows affected → 404 (the isolation keystone, never 403).
	mock.ExpectExec("DELETE FROM lens_saved_views").
		WillReturnResult(sqlmock.NewResult(0, 0))

	h := NewLensSavedViewsHandler(dbConn, nil)
	rc := chi.NewRouteContext()
	rc.URLParams.Add("id", "lsv-0011223344556677")
	r := lsvReq(http.MethodDelete, "/v1/dashboard/lens/saved-views/lsv-0011223344556677", "", "tn-1")
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rc))
	w := httptest.NewRecorder()
	h.Delete(w, r)

	if w.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404 (cross-tenant/non-existent collapse to 404, never 403)", w.Code)
	}
}

func TestLensSavedViews_Delete_RejectsMalformedID(t *testing.T) {
	h := &LensSavedViewsHandler{}
	rc := chi.NewRouteContext()
	rc.URLParams.Add("id", "not-a-valid-id")
	r := lsvReq(http.MethodDelete, "/v1/dashboard/lens/saved-views/not-a-valid-id", "", "tn-1")
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rc))
	w := httptest.NewRecorder()
	h.Delete(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 for malformed id", w.Code)
	}
}

func TestLensSavedViews_Delete_SucceedsWithNoContent(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	mock.ExpectExec("DELETE FROM lens_saved_views").
		WillReturnResult(sqlmock.NewResult(0, 1)) // one owned row deleted

	h := NewLensSavedViewsHandler(dbConn, nil)
	rc := chi.NewRouteContext()
	rc.URLParams.Add("id", "lsv-0011223344556677")
	r := lsvReq(http.MethodDelete, "/v1/dashboard/lens/saved-views/lsv-0011223344556677", "", "tn-1")
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rc))
	w := httptest.NewRecorder()
	h.Delete(w, r)
	if w.Code != http.StatusNoContent {
		t.Fatalf("code = %d, want 204", w.Code)
	}
}
