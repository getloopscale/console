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
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-chi/chi/v5"

	"github.com/usetheoai/theo-cloud/internal/auth"
)

// theo-lens M53 — LensAlertRulesHandler. Per-tenant threshold alert rules, mirroring the M52
// lens_saved_views isolation (subject+tenant_id scoping, 404-not-403 cross-tenant delete).

func larReq(method, target, body, tenant string) *http.Request {
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

func TestLensAlertRules_Create_Unauthenticated_401(t *testing.T) {
	h := &LensAlertRulesHandler{}
	w := httptest.NewRecorder()
	h.Create(w, larReq(http.MethodPost, "/v1/dashboard/lens/alert-rules",
		`{"name":"n","metric":"error_rate","comparator":"gt","threshold":5,"window_seconds":3600,"webhook_id":"wwh-x"}`, ""))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("code = %d, want 401", w.Code)
	}
}

func TestLensAlertRules_Create_RejectsBadMetric(t *testing.T) {
	h := &LensAlertRulesHandler{}
	w := httptest.NewRecorder()
	h.Create(w, larReq(http.MethodPost, "/v1/dashboard/lens/alert-rules",
		`{"name":"n","metric":"bogus","comparator":"gt","threshold":5,"window_seconds":3600,"webhook_id":"wwh-x"}`, "tn-1"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 for bad metric", w.Code)
	}
}

func TestLensAlertRules_Create_RejectsBadComparatorAndWindowAndWebhook(t *testing.T) {
	h := &LensAlertRulesHandler{}
	for _, body := range []string{
		`{"name":"n","metric":"cost","comparator":"eq","threshold":5,"window_seconds":3600,"webhook_id":"wwh-x"}`, // eq not allowed
		`{"name":"n","metric":"cost","comparator":"gt","threshold":5,"window_seconds":0,"webhook_id":"wwh-x"}`,    // window 0
		`{"name":"n","metric":"cost","comparator":"gt","threshold":5,"window_seconds":3600,"webhook_id":""}`,      // no webhook
	} {
		w := httptest.NewRecorder()
		h.Create(w, larReq(http.MethodPost, "/v1/dashboard/lens/alert-rules", body, "tn-1"))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("code = %d, want 400 for %s", w.Code, body)
		}
	}
}

func TestLensAlertRules_Create_InsertsAndReturnsID(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	// ownership check: the webhook belongs to this tenant → one row
	mock.ExpectQuery("SELECT 1 FROM workspace_webhooks").
		WithArgs("wwh-001122", "tn-1").
		WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(1))
	mock.ExpectExec("INSERT INTO lens_alert_rules").WillReturnResult(sqlmock.NewResult(0, 1))

	h := NewLensAlertRulesHandler(dbConn, nil, nil)
	w := httptest.NewRecorder()
	h.Create(w, larReq(http.MethodPost, "/v1/dashboard/lens/alert-rules",
		`{"name":"errors > 5%","metric":"error_rate","comparator":"gt","threshold":5,"window_seconds":3600,"webhook_id":"wwh-001122"}`, "tn-1"))

	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200 (body=%s)", w.Code, w.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if id, _ := resp["id"].(string); !strings.HasPrefix(id, "lar-") {
		t.Errorf("id = %v, want lar- prefix", resp["id"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("sqlmock expectations: %v", err)
	}
}

// The isolation keystone: a rule targeting a webhook NOT owned by the caller's tenant is rejected
// (400), never inserted — so tenant A can never POST its alerts to tenant B's endpoint.
func TestLensAlertRules_Create_RejectsForeignWebhook(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	// the ownership check finds no matching (webhook_id, tenant_id) → the rule is rejected before INSERT
	mock.ExpectQuery("SELECT 1 FROM workspace_webhooks").
		WithArgs("wwh-otherowner", "tn-1").
		WillReturnError(sql.ErrNoRows)

	h := NewLensAlertRulesHandler(dbConn, nil, nil)
	w := httptest.NewRecorder()
	h.Create(w, larReq(http.MethodPost, "/v1/dashboard/lens/alert-rules",
		`{"name":"leaky","metric":"cost","comparator":"gt","threshold":5,"window_seconds":3600,"webhook_id":"wwh-otherowner"}`, "tn-1"))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 for a webhook not owned by the tenant", w.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("no INSERT should follow a failed ownership check: %v", err)
	}
}

func TestLensAlertRules_List_ScopedToSubjectAndTenant(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	mock.ExpectQuery("SELECT id, name, metric, comparator").
		WithArgs("sub-1", "tn-1", sqlmock.AnyArg()). // the (subject, tenant_id) isolation binds here
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "name", "metric", "comparator", "threshold", "window_seconds", "webhook_id", "enabled",
			"status", "last_evaluated_at", "last_triggered_at", "renotify_interval_seconds", "created_at",
			"monitor_id", "stale",
		}).AddRow("lar-0011223344556677", "errs", "error_rate", "gt", 5.0, 3600, "wwh-1", true,
			"TRIGGERED", "2026-07-04T10:00:00Z", "2026-07-04T10:05:00Z", nil, "2026-07-04T09:00:00Z",
			nil, false))

	h := NewLensAlertRulesHandler(dbConn, nil, nil)
	w := httptest.NewRecorder()
	h.List(w, larReq(http.MethodGet, "/v1/dashboard/lens/alert-rules", "", "tn-1"))

	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, "lar-0011223344556677") || !strings.Contains(body, "TRIGGERED") {
		t.Errorf("list body missing rule or state: %s", body)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("sqlmock expectations: %v", err)
	}
}

func TestLensAlertRules_Delete_NotFoundWhenZeroRows(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	// cross-tenant / non-existent → 0 rows → 404 (never 403, the isolation keystone)
	mock.ExpectExec("DELETE FROM lens_alert_rules").WillReturnResult(sqlmock.NewResult(0, 0))

	h := NewLensAlertRulesHandler(dbConn, nil, nil)
	rc := chi.NewRouteContext()
	rc.URLParams.Add("id", "lar-0011223344556677")
	r := larReq(http.MethodDelete, "/v1/dashboard/lens/alert-rules/lar-0011223344556677", "", "tn-1")
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rc))
	w := httptest.NewRecorder()
	h.Delete(w, r)
	if w.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404 (cross-tenant/non-existent collapse to 404)", w.Code)
	}
}

func TestLensAlertRules_Delete_RejectsMalformedID(t *testing.T) {
	h := &LensAlertRulesHandler{}
	rc := chi.NewRouteContext()
	rc.URLParams.Add("id", "nope")
	r := larReq(http.MethodDelete, "/v1/dashboard/lens/alert-rules/nope", "", "tn-1")
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rc))
	w := httptest.NewRecorder()
	h.Delete(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 for malformed id", w.Code)
	}
}

func TestLensAlertRules_Toggle_ScopedUpdate(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	mock.ExpectExec("UPDATE lens_alert_rules SET enabled").
		WithArgs(false, "lar-0011223344556677", "sub-1", "tn-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	h := NewLensAlertRulesHandler(dbConn, nil, nil)
	rc := chi.NewRouteContext()
	rc.URLParams.Add("id", "lar-0011223344556677")
	r := larReq(http.MethodPatch, "/v1/dashboard/lens/alert-rules/lar-0011223344556677", `{"enabled":false}`, "tn-1")
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rc))
	w := httptest.NewRecorder()
	h.Toggle(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", w.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("sqlmock expectations: %v", err)
	}
}

// M84 — history helper: sets the chi {id} param + the tenant user context.
func histReq(id, target, tenant string) *http.Request {
	r := larReq(http.MethodGet, target, "", tenant)
	rc := chi.NewRouteContext()
	rc.URLParams.Add("id", id)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rc))
}

func TestLensAlertRules_History_ReturnsPaginatedFirings(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	id := "lar-0011223344556677"
	// ownership gate → owns; count → 3; page → 2 rows
	mock.ExpectQuery("SELECT 1 FROM lens_alert_rules").WithArgs(id, "sub-1", "tn-1").
		WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(1))
	mock.ExpectQuery("SELECT count\\(\\*\\) FROM lens_fired_alerts").WithArgs(id, "tn-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))
	mock.ExpectQuery("SELECT id, metric, comparator, threshold, value, fired_at").
		WithArgs(id, "tn-1", 20, 0).
		WillReturnRows(sqlmock.NewRows([]string{"id", "metric", "comparator", "threshold", "value", "fired_at"}).
			AddRow("lfa-1", "error_rate", "gt", 0.05, 0.20, "2026-07-08T00:00:00Z").
			AddRow("lfa-2", "error_rate", "gt", 0.05, 0.15, "2026-07-07T00:00:00Z"))

	h := NewLensAlertRulesHandler(dbConn, nil, nil)
	w := httptest.NewRecorder()
	h.History(w, histReq(id, "/v1/dashboard/lens/alert-rules/"+id+"/history", "tn-1"))
	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200 (%s)", w.Code, w.Body.String())
	}
	var resp struct {
		Firings []map[string]any `json:"firings"`
		Total   int              `json:"total"`
		Limit   int              `json:"limit"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Total != 3 || len(resp.Firings) != 2 || resp.Limit != 20 {
		t.Fatalf("want total=3 firings=2 limit=20, got total=%d firings=%d limit=%d", resp.Total, len(resp.Firings), resp.Limit)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("sqlmock expectations: %v", err)
	}
}

func TestLensAlertRules_History_NotFoundForForeignRule(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	id := "lar-0011223344556677"
	// the ownership gate returns no rows → 404, and NO fired-alerts read runs (no leak).
	mock.ExpectQuery("SELECT 1 FROM lens_alert_rules").WithArgs(id, "sub-1", "tn-x").
		WillReturnError(sql.ErrNoRows)

	h := NewLensAlertRulesHandler(dbConn, nil, nil)
	w := httptest.NewRecorder()
	h.History(w, histReq(id, "/v1/dashboard/lens/alert-rules/"+id+"/history", "tn-x"))
	if w.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404 for a foreign/non-existent rule", w.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("a foreign rule must NOT read fired_alerts: %v", err)
	}
}

func TestLensAlertRules_History_RejectsMalformedID(t *testing.T) {
	h := &LensAlertRulesHandler{}
	w := httptest.NewRecorder()
	h.History(w, histReq("nope", "/v1/dashboard/lens/alert-rules/nope/history", "tn-1"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 for malformed id", w.Code)
	}
}

func TestLensAlertRules_History_Unauthenticated_401(t *testing.T) {
	h := &LensAlertRulesHandler{}
	w := httptest.NewRecorder()
	h.History(w, histReq("lar-0011223344556677", "/v1/dashboard/lens/alert-rules/lar-0011223344556677/history", ""))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("code = %d, want 401", w.Code)
	}
}

// M84 — the page params clamp: limit ∈ [1,100] default 20, offset ≥ 0. Out-of-range values fall back
// to the defaults (a negative-case sweep — testing.md §4.1).
func TestLensAlertRules_History_ClampsPageParams(t *testing.T) {
	id := "lar-0011223344556677"
	cases := []struct {
		qs                    string
		wantLimit, wantOffset int
	}{
		{"?limit=0", 20, 0},             // 0 → default
		{"?limit=101", 20, 0},           // over cap → default
		{"?limit=-1", 20, 0},            // negative → default
		{"?limit=50&offset=10", 50, 10}, // valid pass-through
		{"?offset=-5", 20, 0},           // negative offset → default 0
	}
	for _, c := range cases {
		dbConn, mock, _ := sqlmock.New()
		mock.ExpectQuery("SELECT 1 FROM lens_alert_rules").WithArgs(id, "sub-1", "tn-1").
			WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(1))
		mock.ExpectQuery("SELECT count\\(\\*\\) FROM lens_fired_alerts").WithArgs(id, "tn-1").
			WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
		mock.ExpectQuery("SELECT id, metric, comparator, threshold, value, fired_at").
			WithArgs(id, "tn-1", c.wantLimit, c.wantOffset).
			WillReturnRows(sqlmock.NewRows([]string{"id", "metric", "comparator", "threshold", "value", "fired_at"}))
		h := NewLensAlertRulesHandler(dbConn, nil, nil)
		w := httptest.NewRecorder()
		h.History(w, histReq(id, "/v1/dashboard/lens/alert-rules/"+id+"/history"+c.qs, "tn-1"))
		if w.Code != http.StatusOK {
			t.Fatalf("%s: code = %d, want 200", c.qs, w.Code)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("%s: bound args mismatch (clamp wrong): %v", c.qs, err)
		}
		_ = dbConn.Close()
	}
}

// ── M135 — the guard pairing, rejected at the friendly layer ─────────────────────────────────────
//
// Migration 000058's CHECK enforces this too. This is the half that gives the user a typed message
// instead of a constraint violation, and it must reject BOTH directions: a guard rule without a
// guard, and a guard on a rule that cannot use one. Both are silently broken states otherwise —
// the first is an armed rule that can never fire, the second is a field quietly ignored.
func TestLensAlertRules_Create_MonitorPairingIsEnforced(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"monitor_breach without monitor_id", `{"name":"g","metric":"monitor_breach","comparator":"gt","threshold":5,"window_seconds":3600,"webhook_id":"wwh-1"}`},
		{"monitor_id on a cost rule", `{"name":"g","metric":"cost","comparator":"gt","threshold":5,"window_seconds":3600,"webhook_id":"wwh-1","monitor_id":"g-1"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dbConn, _, _ := sqlmock.New()
			defer func() { _ = dbConn.Close() }()
			h := NewLensAlertRulesHandler(dbConn, nil, nil)
			w := httptest.NewRecorder()
			h.Create(w, larReq(http.MethodPost, "/v1/dashboard/lens/alert-rules", tc.body, "tn-1"))
			if w.Code != http.StatusBadRequest {
				t.Fatalf("code = %d, want 400 (%s)", w.Code, tc.name)
			}
			if !strings.Contains(w.Body.String(), "INVALID_MONITOR") {
				t.Fatalf("want typed INVALID_MONITOR, got %s", w.Body.String())
			}
		})
	}
}

// A definitive not-owned answer rejects the create — validate at the one moment a human is present
// to fix the typo. A transport failure must NOT reject: importing theo-lens's availability into our
// write path would trade a rare typo for a common outage.
func TestLensAlertRules_Create_MonitorOwnership(t *testing.T) {
	body := `{"name":"g","metric":"monitor_breach","comparator":"gt","threshold":5,"window_seconds":3600,"webhook_id":"wwh-1","monitor_id":"g-1"}`

	t.Run("not owned rejects", func(t *testing.T) {
		dbConn, mock, _ := sqlmock.New()
		defer func() { _ = dbConn.Close() }()
		mock.ExpectQuery("SELECT 1 FROM workspace_webhooks").WithArgs("wwh-1", "tn-1").
			WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(1))
		h := NewLensAlertRulesHandler(dbConn, func(context.Context, string, string) error {
			return ErrMonitorNotOwned
		}, nil)
		w := httptest.NewRecorder()
		h.Create(w, larReq(http.MethodPost, "/v1/dashboard/lens/alert-rules", body, "tn-1"))
		if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "INVALID_MONITOR") {
			t.Fatalf("code = %d body = %s, want 400 INVALID_MONITOR", w.Code, w.Body.String())
		}
	})

	t.Run("transport failure still accepts", func(t *testing.T) {
		dbConn, mock, _ := sqlmock.New()
		defer func() { _ = dbConn.Close() }()
		mock.ExpectQuery("SELECT 1 FROM workspace_webhooks").WithArgs("wwh-1", "tn-1").
			WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(1))
		mock.ExpectExec("INSERT INTO lens_alert_rules").WillReturnResult(sqlmock.NewResult(0, 1))
		h := NewLensAlertRulesHandler(dbConn, func(context.Context, string, string) error {
			return errors.New("connection reset")
		}, nil)
		w := httptest.NewRecorder()
		h.Create(w, larReq(http.MethodPost, "/v1/dashboard/lens/alert-rules", body, "tn-1"))
		if w.Code != http.StatusOK {
			t.Fatalf("code = %d body = %s, want 200 (a lens blip must not block a create)", w.Code, w.Body.String())
		}
	})
}

// ── M136 — the deprecated request field must still work ──────────────────────────────────────────
//
// The rename is only safe if a client written against the previous shape keeps working. Asserting
// it here means the compatibility is a tested property rather than an intention stated in a
// CHANGELOG — the class of claim that rots silently precisely because nothing exercises it.
func TestLensAlertRules_Create_AcceptsTheDeprecatedGuardIdField(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	mock.ExpectQuery("SELECT 1 FROM workspace_webhooks").WithArgs("wwh-1", "tn-1").
		WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(1))
	mock.ExpectExec("INSERT INTO lens_alert_rules").WillReturnResult(sqlmock.NewResult(0, 1))

	var seen string
	h := NewLensAlertRulesHandler(dbConn, func(_ context.Context, _, id string) error {
		seen = id
		return nil
	}, nil)
	// Old shape: monitor_id only, no monitor_id.
	body := `{"name":"legacy","metric":"monitor_breach","comparator":"gt","threshold":5,"window_seconds":3600,"webhook_id":"wwh-1","guard_id":"g-legacy"}`
	w := httptest.NewRecorder()
	h.Create(w, larReq(http.MethodPost, "/v1/dashboard/lens/alert-rules", body, "tn-1"))

	if w.Code != http.StatusOK {
		t.Fatalf("code = %d body = %s, want 200 — the deprecated field must still create a rule", w.Code, w.Body.String())
	}
	if seen != "g-legacy" {
		t.Fatalf("verifier saw %q — the deprecated field must reach the same code path", seen)
	}
}

// When BOTH names arrive, the canonical one wins. A client mid-migration sending both must never be
// ambiguous, and "last field wins" would depend on struct order — an accident, not a contract.
func TestLensAlertRules_Create_CanonicalFieldWinsOverDeprecated(t *testing.T) {
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()
	mock.ExpectQuery("SELECT 1 FROM workspace_webhooks").WithArgs("wwh-1", "tn-1").
		WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(1))
	mock.ExpectExec("INSERT INTO lens_alert_rules").WillReturnResult(sqlmock.NewResult(0, 1))

	var seen string
	h := NewLensAlertRulesHandler(dbConn, func(_ context.Context, _, id string) error {
		seen = id
		return nil
	}, nil)
	body := `{"name":"both","metric":"monitor_breach","comparator":"gt","threshold":5,"window_seconds":3600,"webhook_id":"wwh-1","monitor_id":"m-new","guard_id":"g-old"}`
	w := httptest.NewRecorder()
	h.Create(w, larReq(http.MethodPost, "/v1/dashboard/lens/alert-rules", body, "tn-1"))

	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", w.Code)
	}
	if seen != "m-new" {
		t.Fatalf("verifier saw %q, want the canonical monitor_id to win", seen)
	}
}

// The response must carry BOTH names, same value. `go vet` caught a regex slip that rewrote the
// deprecated tag to the canonical one, which would have silently dropped `guard_id` from every
// response — the exact break the dual field exists to prevent, introduced by the mechanism meant
// to prevent it. A struct-tag mistake is invisible to every test that only reads the Go field.
func TestLensAlertRuleView_EmitsBothMonitorIdNames(t *testing.T) {
	id := "m-1"
	raw, err := json.Marshal(LensAlertRuleView{MonitorID: &id, GuardID: &id})
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["monitor_id"] != id {
		t.Fatalf("canonical monitor_id missing from %s", raw)
	}
	if decoded["guard_id"] != id {
		t.Fatalf("deprecated guard_id missing from %s — dropping it is a silent break", raw)
	}
}
