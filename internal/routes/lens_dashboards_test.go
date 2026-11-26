// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package routes

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-chi/chi/v5"

	"github.com/getloopscale/loop-console/internal/auth"
)

// looptrace M66 — LensDashboardsHandler. Per-WORKSPACE custom dashboards (tenant_id scoping,
// config-blob boundary validation, 404-not-403 cross-tenant). Mirrors the M52 saved-views harness.

const validConfig = `[{"type":"kpi","metric":"traces","title":"Traces"},{"type":"trend","metric":"p95_latency"},{"type":"topn","metric":"tokens_by_model"}]`

func ldbReq(method, target, body, tenant string) *http.Request {
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

func ldbWithID(r *http.Request, id string) *http.Request {
	rc := chi.NewRouteContext()
	rc.URLParams.Add("id", id)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rc))
}

func TestLensDashboards_Create_Unauthenticated_401(t *testing.T) {
	h := &LensDashboardsHandler{}
	w := httptest.NewRecorder()
	h.Create(w, ldbReq(http.MethodPost, "/v1/dashboard/lens/dashboards", `{"name":"n","config":`+validConfig+`}`, ""))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("code = %d, want 401", w.Code)
	}
}

func TestLensDashboards_Create_RejectsEmptyName(t *testing.T) {
	h := &LensDashboardsHandler{}
	w := httptest.NewRecorder()
	h.Create(w, ldbReq(http.MethodPost, "/v1/dashboard/lens/dashboards", `{"name":"  ","config":`+validConfig+`}`, "tn-1"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 for empty name", w.Code)
	}
}

func TestLensDashboards_Create_RejectsEmptyWidgets(t *testing.T) {
	h := &LensDashboardsHandler{}
	w := httptest.NewRecorder()
	h.Create(w, ldbReq(http.MethodPost, "/v1/dashboard/lens/dashboards", `{"name":"n","config":[]}`, "tn-1"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 for empty widgets", w.Code)
	}
}

func TestLensDashboards_Create_RejectsUnknownType(t *testing.T) {
	h := &LensDashboardsHandler{}
	w := httptest.NewRecorder()
	h.Create(w, ldbReq(http.MethodPost, "/v1/dashboard/lens/dashboards",
		`{"name":"n","config":[{"type":"pie","metric":"traces"}]}`, "tn-1"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 for unknown widget type", w.Code)
	}
}

func TestLensDashboards_Create_RejectsUnknownMetric(t *testing.T) {
	h := &LensDashboardsHandler{}
	w := httptest.NewRecorder()
	h.Create(w, ldbReq(http.MethodPost, "/v1/dashboard/lens/dashboards",
		`{"name":"n","config":[{"type":"kpi","metric":"revenue"}]}`, "tn-1"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 for unknown metric", w.Code)
	}
}

func TestLensDashboards_Create_RejectsOversizeWidgets(t *testing.T) {
	h := &LensDashboardsHandler{}
	big := "[" + strings.Repeat(`{"type":"kpi","metric":"traces"},`, 25)
	big = strings.TrimRight(big, ",") + "]"
	w := httptest.NewRecorder()
	h.Create(w, ldbReq(http.MethodPost, "/v1/dashboard/lens/dashboards", `{"name":"n","config":`+big+`}`, "tn-1"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 for >24 widgets", w.Code)
	}
}

func TestLensDashboards_Create_InsertsAndReturnsID(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	// INSERT binds tenant_id + created_by from the Principal (never the body).
	mock.ExpectExec("INSERT INTO lens_dashboards").
		WithArgs(sqlmock.AnyArg(), "tn-1", "sub-1", "My board", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	h := NewLensDashboardsHandler(dbConn, nil)
	w := httptest.NewRecorder()
	h.Create(w, ldbReq(http.MethodPost, "/v1/dashboard/lens/dashboards", `{"name":"My board","config":`+validConfig+`}`, "tn-1"))

	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200 (body=%s)", w.Code, w.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if id, _ := resp["id"].(string); !strings.HasPrefix(id, "ldb-") {
		t.Errorf("id = %q, want ldb- prefix", id)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("sqlmock expectations: %v", err)
	}
}

func TestLensDashboards_List_ScopedToTenant(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	// The workspace isolation binds tenant_id ONLY (a shared team board — D5), never subject.
	mock.ExpectQuery("SELECT id, name, config, created_by, created_at, updated_at").
		WithArgs("tn-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "config", "created_by", "created_at", "updated_at"}).
			AddRow("ldb-0011223344556677", "Board", []byte(validConfig), "sub-9", "2026-07-07T10:00:00Z", "2026-07-07T10:00:00Z"))

	h := NewLensDashboardsHandler(dbConn, nil)
	w := httptest.NewRecorder()
	h.List(w, ldbReq(http.MethodGet, "/v1/dashboard/lens/dashboards", "", "tn-1"))

	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), "ldb-0011223344556677") {
		t.Errorf("list body missing the board: %s", w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("sqlmock expectations: %v", err)
	}
}

func TestLensDashboards_Get_CrossTenant404(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	// A foreign board id → no row for this tenant → 404 (never 403, never leaks existence).
	mock.ExpectQuery("SELECT id, name, config, created_by, created_at, updated_at").
		WithArgs("ldb-0011223344556677", "tn-1").
		WillReturnError(sql.ErrNoRows)

	h := NewLensDashboardsHandler(dbConn, nil)
	w := httptest.NewRecorder()
	h.Get(w, ldbWithID(ldbReq(http.MethodGet, "/v1/dashboard/lens/dashboards/ldb-0011223344556677", "", "tn-1"), "ldb-0011223344556677"))

	if w.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404 for a cross-tenant/non-existent board", w.Code)
	}
}

func TestLensDashboards_Update_ReplacesConfigScoped(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	mock.ExpectExec("UPDATE lens_dashboards SET name").
		WithArgs("Renamed", sqlmock.AnyArg(), "ldb-0011223344556677", "tn-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	h := NewLensDashboardsHandler(dbConn, nil)
	w := httptest.NewRecorder()
	h.Update(w, ldbWithID(ldbReq(http.MethodPut, "/v1/dashboard/lens/dashboards/ldb-0011223344556677",
		`{"name":"Renamed","config":`+validConfig+`}`, "tn-1"), "ldb-0011223344556677"))

	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200 (body=%s)", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("sqlmock expectations: %v", err)
	}
}

func TestLensDashboards_Update_CrossTenant404(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	mock.ExpectExec("UPDATE lens_dashboards SET name").
		WillReturnResult(sqlmock.NewResult(0, 0)) // 0 rows → not this tenant's board

	h := NewLensDashboardsHandler(dbConn, nil)
	w := httptest.NewRecorder()
	h.Update(w, ldbWithID(ldbReq(http.MethodPut, "/v1/dashboard/lens/dashboards/ldb-0011223344556677",
		`{"name":"x","config":`+validConfig+`}`, "tn-1"), "ldb-0011223344556677"))

	if w.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404 (cross-tenant update collapses to 404)", w.Code)
	}
}

func TestLensDashboards_Delete_CrossTenant404(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	mock.ExpectExec("DELETE FROM lens_dashboards").
		WillReturnResult(sqlmock.NewResult(0, 0))

	h := NewLensDashboardsHandler(dbConn, nil)
	w := httptest.NewRecorder()
	h.Delete(w, ldbWithID(ldbReq(http.MethodDelete, "/v1/dashboard/lens/dashboards/ldb-0011223344556677", "", "tn-1"), "ldb-0011223344556677"))

	if w.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404 (cross-tenant/non-existent collapse to 404, never 403)", w.Code)
	}
}

func TestLensDashboards_Delete_SucceedsWithNoContent(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	mock.ExpectExec("DELETE FROM lens_dashboards").
		WillReturnResult(sqlmock.NewResult(0, 1))

	h := NewLensDashboardsHandler(dbConn, nil)
	w := httptest.NewRecorder()
	h.Delete(w, ldbWithID(ldbReq(http.MethodDelete, "/v1/dashboard/lens/dashboards/ldb-0011223344556677", "", "tn-1"), "ldb-0011223344556677"))

	if w.Code != http.StatusNoContent {
		t.Fatalf("code = %d, want 204", w.Code)
	}
}

func TestLensDashboards_Delete_RejectsMalformedID(t *testing.T) {
	h := &LensDashboardsHandler{}
	w := httptest.NewRecorder()
	h.Delete(w, ldbWithID(ldbReq(http.MethodDelete, "/v1/dashboard/lens/dashboards/nope", "", "tn-1"), "nope"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 for malformed id", w.Code)
	}
}
