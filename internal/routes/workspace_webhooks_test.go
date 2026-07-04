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
	"github.com/usetheodev/theo-cloud/internal/auth"
)

// J-16 slice 2 — WorkspaceWebhooksHandler, a mirror of MemoryWebhooksHandler for
// deploy-event webhooks. Registration-only v0.1 (delivery is a later T2 slice).

func wwhReq(method, target, body, tenant string) *http.Request {
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

func TestWorkspaceWebhooks_Create_Unauthenticated_401(t *testing.T) {
	h := &WorkspaceWebhooksHandler{}
	w := httptest.NewRecorder()
	h.Create(w, wwhReq(http.MethodPost, "/v1/webhooks", `{"url":"https://x","label":"l","events":["deploy.succeeded"]}`, ""))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("code = %d, want 401", w.Code)
	}
}

func TestWorkspaceWebhooks_Create_RejectsNonHTTPURL(t *testing.T) {
	h := &WorkspaceWebhooksHandler{}
	w := httptest.NewRecorder()
	h.Create(w, wwhReq(http.MethodPost, "/v1/webhooks", `{"url":"ftp://x","label":"l","events":["deploy.succeeded"]}`, "tn-1"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 for non-http URL", w.Code)
	}
}

func TestWorkspaceWebhooks_Create_RejectsEmptyEvents(t *testing.T) {
	h := &WorkspaceWebhooksHandler{}
	w := httptest.NewRecorder()
	h.Create(w, wwhReq(http.MethodPost, "/v1/webhooks", `{"url":"https://x","label":"l","events":[]}`, "tn-1"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 for empty events", w.Code)
	}
}

func TestWorkspaceWebhooks_Create_InsertsAndReturnsSecretOnce(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	mock.ExpectExec("INSERT INTO workspace_webhooks").
		WillReturnResult(sqlmock.NewResult(0, 1))

	h := NewWorkspaceWebhooksHandler(dbConn, nil)
	w := httptest.NewRecorder()
	h.Create(w, wwhReq(http.MethodPost, "/v1/webhooks",
		`{"url":"https://hooks.example.com/x","label":"prod","events":["deploy.succeeded","deploy.failed"]}`, "tn-1"))

	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200 (body=%s)", w.Code, w.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	id, _ := resp["id"].(string)
	if !strings.HasPrefix(id, "wwh-") {
		t.Errorf("id = %q, want wwh- prefix", id)
	}
	secret, _ := resp["secret"].(string)
	if !strings.HasPrefix(secret, "whsec_") {
		t.Errorf("secret = %q, want whsec_ prefix (shown once)", secret)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("sqlmock expectations: %v", err)
	}
}

func TestWorkspaceWebhooks_List_ReturnsActiveScopedToTenant(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	mock.ExpectQuery("SELECT id, url, label, events, created_at").
		WithArgs("sub-1", "tn-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "url", "label", "events", "created_at"}).
			AddRow("wwh-0011223344556677", "https://x", "prod", []byte(`["deploy.succeeded"]`), "2026-07-03T10:00:00Z"))

	h := NewWorkspaceWebhooksHandler(dbConn, nil)
	w := httptest.NewRecorder()
	h.List(w, wwhReq(http.MethodGet, "/v1/webhooks/list", "", "tn-1"))

	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), "wwh-0011223344556677") {
		t.Errorf("list body missing the webhook: %s", w.Body.String())
	}
}

func TestWorkspaceWebhooks_Delete_NotFoundWhenZeroRows(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	mock.ExpectExec("UPDATE workspace_webhooks").
		WillReturnResult(sqlmock.NewResult(0, 0)) // 0 rows → cross-tenant/non-existent

	h := NewWorkspaceWebhooksHandler(dbConn, nil)
	rc := chi.NewRouteContext()
	rc.URLParams.Add("id", "wwh-0011223344556677")
	r := wwhReq(http.MethodDelete, "/v1/webhooks/wwh-0011223344556677", "", "tn-1")
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rc))
	w := httptest.NewRecorder()
	h.Delete(w, r)

	if w.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404 (cross-tenant/non-existent collapse to 404)", w.Code)
	}
}

func TestWorkspaceWebhooks_Deliveries_Unauthenticated_401(t *testing.T) {
	h := &WorkspaceWebhooksHandler{}
	rc := chi.NewRouteContext()
	rc.URLParams.Add("id", "wwh-0011223344556677")
	r := wwhReq(http.MethodGet, "/v1/settings/webhooks/wwh-0011223344556677/deliveries", "", "")
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rc))
	w := httptest.NewRecorder()
	h.Deliveries(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("code = %d, want 401", w.Code)
	}
}

func TestWorkspaceWebhooks_Deliveries_RejectsMalformedID(t *testing.T) {
	h := &WorkspaceWebhooksHandler{}
	rc := chi.NewRouteContext()
	rc.URLParams.Add("id", "not-valid")
	r := wwhReq(http.MethodGet, "/v1/settings/webhooks/not-valid/deliveries", "", "tn-1")
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rc))
	w := httptest.NewRecorder()
	h.Deliveries(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 for malformed id", w.Code)
	}
}

func TestWorkspaceWebhooks_Deliveries_ListsScopedToOwner(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	mock.ExpectQuery("SELECT d.id, d.event_type, d.status").
		WithArgs("wwh-0011223344556677", "sub-1", "tn-1", 10).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "event_type", "status", "attempt_count",
			"last_response_status", "last_error_message", "created_at", "completed_at",
		}).AddRow("wwd-1", "deploy.succeeded", "delivered", 1, 200, nil, "2026-07-04T10:00:00Z", "2026-07-04T10:00:01Z"))

	h := NewWorkspaceWebhooksHandler(dbConn, nil)
	rc := chi.NewRouteContext()
	rc.URLParams.Add("id", "wwh-0011223344556677")
	r := wwhReq(http.MethodGet, "/v1/settings/webhooks/wwh-0011223344556677/deliveries", "", "tn-1")
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rc))
	w := httptest.NewRecorder()
	h.Deliveries(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200 (body=%s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "wwd-1") || !strings.Contains(w.Body.String(), "delivered") {
		t.Errorf("deliveries body missing the row: %s", w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("sqlmock expectations: %v", err)
	}
}

func TestWorkspaceWebhooks_Delete_RejectsMalformedID(t *testing.T) {
	h := &WorkspaceWebhooksHandler{}
	rc := chi.NewRouteContext()
	rc.URLParams.Add("id", "not-a-valid-id")
	r := wwhReq(http.MethodDelete, "/v1/webhooks/not-a-valid-id", "", "tn-1")
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rc))
	w := httptest.NewRecorder()
	h.Delete(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 for malformed id", w.Code)
	}
}
