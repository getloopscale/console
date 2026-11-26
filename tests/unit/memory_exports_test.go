// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// Plan 3 of dashboard-memory-section-roadmap.md, T3.3.
// Tests for the 3 memory export handlers (Create / Status / Download).
// Focused on D1 (EC-16): server-generated UUID filename — client body
// `filename` is IGNORED. Path traversal attempts on the {id} URL param
// rejected with 400 BEFORE the DB is touched.

package unit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/go-chi/chi/v5"

	"github.com/getloopscale/loop-console/internal/auth"
	"github.com/getloopscale/loop-console/internal/loopmem"
	"github.com/getloopscale/loop-console/internal/routes"
)

func newExportsHandler(t *testing.T) (*routes.MemoryExportsHandler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	fake := &fakeTheMemory{
		listResp: &loopmem.ListResult{Memories: []loopmem.MemoryRow{
			{ID: "m1", Content: "fact"},
		}},
	}
	// Worker delay 0 → completes synchronously in tests (no goroutine wait).
	// Export dir is a t.TempDir so files clean up automatically.
	h := routes.NewMemoryExportsHandler(db, fake, nil, t.TempDir(), 0)
	// Red Team loop-console#104 closure: wait for the detached worker
	// goroutines BEFORE the TempDir cleanup + sqlmock close fire,
	// otherwise the worker can race the test teardown — observable as
	// `sql: database is closed` warnings and `directory not empty`
	// TempDir errors under `-race`. The Cleanup stack is LIFO, so we
	// register the wait FIRST (it runs LAST), then the db.Close (runs
	// AFTER the worker is joined).
	t.Cleanup(h.WaitForWorkers)
	t.Cleanup(func() { _ = db.Close() })
	return h, mock
}

func TestMemoryExports_CreateRejectsUnauthenticated(t *testing.T) {
	h, _ := newExportsHandler(t)
	rec := httptest.NewRecorder()
	h.Create(rec, httptest.NewRequest("POST", "/v1/memory/exports", strings.NewReader(`{}`)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

// T3.3 — D1 / EC-16 absorption: client-supplied `filename` is IGNORED.
// The persisted id is server-generated; the on-disk filename derives from
// the id, never from the request body. A `filename: "../../etc/passwd"`
// attempt MUST not appear in any persisted state.
func TestMemoryExports_CreateIgnoresClientFilename(t *testing.T) {
	h, mock := newExportsHandler(t)
	mock.ExpectExec("INSERT INTO memory_exports").
		WithArgs(
			sqlmock.AnyArg(), // id — MUST start with "export-" + uuid form, NOT the client filename
			"user-A", "tenant-A",
			sqlmock.AnyArg(), // display_name (label only)
			"pending",
		).
		WillReturnResult(sqlmock.NewResult(1, 1))

	body := `{"filename":"../../etc/passwd","label":"june-backup"}`
	req := httptest.NewRequest("POST", "/v1/memory/exports", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(auth.WithUser(req.Context(), &auth.UserContext{Subject: "user-A", TenantID: "tenant-A"}))
	rec := httptest.NewRecorder()
	h.Create(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var resp struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	// D1 invariant: id is the server-generated form, NEVER contains `..` / `/`
	if !strings.HasPrefix(resp.ID, "export-") {
		t.Errorf("id must start with 'export-', got %q", resp.ID)
	}
	if strings.ContainsAny(resp.ID, "/.\\") {
		t.Errorf("id contains traversal chars — D1 violation: %q", resp.ID)
	}
	if resp.Status != "pending" {
		t.Errorf("expected status 'pending', got %q", resp.Status)
	}
}

// T3.3 — Download path: malformed {id} rejected with 400 BEFORE the DB
// is touched. Prevents path-traversal probes from polluting the download
// flow / slow logs.
func TestMemoryExports_DownloadMalformedIDRejectedBeforeDB(t *testing.T) {
	cases := []string{
		"../etc/passwd",
		"'; DROP",
		"not-a-uuid",
		"",
		"export-../etc",
	}
	for _, malformed := range cases {
		t.Run(malformed, func(t *testing.T) {
			h, mock := newExportsHandler(t)
			req := httptest.NewRequest("GET", "/v1/memory/exports/x/download", nil)
			req = req.WithContext(auth.WithUser(req.Context(), &auth.UserContext{Subject: "u", TenantID: "t"}))
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("id", malformed)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
			rec := httptest.NewRecorder()
			h.Download(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 INVALID_ID, got %d", rec.Code)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("DB called before validation: %v", err)
			}
		})
	}
}

func TestMemoryExports_StatusReturnsRowForOwnExport(t *testing.T) {
	h, mock := newExportsHandler(t)
	mock.ExpectQuery("SELECT id, status, error_message, file_path FROM memory_exports").
		WithArgs("export-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "user-A", "tenant-A").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "error_message", "file_path"}).
			AddRow("export-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "succeeded", nil, "/tmp/x.json"))

	req := httptest.NewRequest("GET", "/v1/memory/exports/x/status", nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.UserContext{Subject: "user-A", TenantID: "tenant-A"}))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "export-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rec := httptest.NewRecorder()
	h.Status(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"status":"succeeded"`) {
		t.Errorf("expected succeeded status, got %s", rec.Body.String())
	}
}

// Cross-tenant Status → 404 (D5 inheritance). The WHERE clause includes
// (subject, tenant_id), so a wrong tenant produces 0 rows.
func TestMemoryExports_CrossTenantStatusReturns404(t *testing.T) {
	h, mock := newExportsHandler(t)
	mock.ExpectQuery("SELECT id, status, error_message, file_path FROM memory_exports").
		WithArgs("export-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "user-B", "tenant-B").
		WillReturnError(sqlNoRowsErr())

	req := httptest.NewRequest("GET", "/v1/memory/exports/x/status", nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.UserContext{Subject: "user-B", TenantID: "tenant-B"}))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "export-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rec := httptest.NewRecorder()
	h.Status(rec, req)

	if rec.Code == http.StatusForbidden {
		t.Fatal("CRITICAL: cross-tenant returned 403 — D5 violation")
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// sqlNoRowsErr returns the sentinel sqlmock surfaces when a QueryRow Scan
// finds zero rows. Mirrors sqlmockErrNoRows() from the scope_middleware_test.go.
func sqlNoRowsErr() error { return sqlmockErrNoRows() }

// issue #6 regression: the export worker must page through ALL memories in
// <=100 chunks (loopmem caps list page size at 100; a single Limit:200 call
// 422s and fails every export). Drives an export to completion across 3 cursor
// pages (100 + 100 + 50 = 250) and asserts: (a) the export file contains all
// 250 memories (no truncation / no failure), and (b) every upstream List call
// respected the <=100 cap and followed the provider cursor.
func TestMemoryExports_WorkerPaginatesPastProviderCap(t *testing.T) {
	mkRows := func(prefix string, n int) []loopmem.MemoryRow {
		rows := make([]loopmem.MemoryRow, n)
		for i := range rows {
			rows[i] = loopmem.MemoryRow{ID: prefix + strconv.Itoa(i), Content: "fact " + prefix + strconv.Itoa(i)}
		}
		return rows
	}
	cur1, cur2 := "cursor-page-2", "cursor-page-3"
	fake := &fakeTheMemory{
		listLimitCap: 100, // provider rejects Limit > 100 (422 INVALID_QUERY)
		listPagesByCursor: map[string]*loopmem.ListResult{
			"":   {Memories: mkRows("a", 100), NextCursor: &cur1},
			cur1: {Memories: mkRows("b", 100), NextCursor: &cur2},
			cur2: {Memories: mkRows("c", 50)}, // last page — no NextCursor
		},
	}

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	mock.MatchExpectationsInOrder(false)
	mock.ExpectExec("INSERT INTO memory_exports").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE memory_exports SET status = 'running'").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE memory_exports SET status = 'succeeded'").WillReturnResult(sqlmock.NewResult(1, 1))

	dir := t.TempDir()
	h := routes.NewMemoryExportsHandler(db, fake, nil, dir, 0)
	t.Cleanup(h.WaitForWorkers)
	t.Cleanup(func() { _ = db.Close() })

	req := httptest.NewRequest("POST", "/v1/memory/exports", strings.NewReader(`{}`))
	req = req.WithContext(auth.WithUser(req.Context(), &auth.UserContext{Subject: "user-A", TenantID: "tenant-A"}))
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("Create: expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid Create JSON: %v", err)
	}

	h.WaitForWorkers()

	// The export file must exist (a failed export writes nothing).
	data, err := os.ReadFile(filepath.Join(dir, resp.ID+".json"))
	if err != nil {
		t.Fatalf("export file not written — worker failed (this is the bug: Limit:200 → 422): %v", err)
	}
	var parsed loopmem.ListResult
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("export file is not valid ListResult JSON: %v\n%s", err, data)
	}
	if len(parsed.Memories) != 250 {
		t.Fatalf("export truncated/incomplete: expected 250 memories, got %d", len(parsed.Memories))
	}

	// Every upstream call must respect the cap and there must be exactly 3 pages.
	if len(fake.listAllOpts) != 3 {
		t.Errorf("expected 3 paged List calls, got %d (%+v)", len(fake.listAllOpts), fake.listAllOpts)
	}
	for i, o := range fake.listAllOpts {
		if o.Limit > 100 {
			t.Errorf("List call %d used Limit=%d (>100 → provider 422)", i, o.Limit)
		}
	}
	// Cursor must be threaded across pages (1st empty, then provider-issued).
	if len(fake.listAllOpts) == 3 {
		if fake.listAllOpts[0].Cursor != "" || fake.listAllOpts[1].Cursor != cur1 || fake.listAllOpts[2].Cursor != cur2 {
			t.Errorf("cursor not threaded across pages: %q, %q, %q",
				fake.listAllOpts[0].Cursor, fake.listAllOpts[1].Cursor, fake.listAllOpts[2].Cursor)
		}
	}
}
