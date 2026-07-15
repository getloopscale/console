// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/storage"
	"github.com/usetheodev/theo-cloud/internal/storage/share"
)

// stubStorageService lets us drive each handler branch deterministically.
type stubStorageService struct {
	uploadErr  error
	downloadRC io.ReadCloser
	downloadMD storage.ObjectMeta
	downloadErr error
	statErr    error
	shareErr   error
	redeemErr  error
	gotTenant  string
	gotPath    string
}

func (s *stubStorageService) Upload(ctx context.Context, tenant, path string, body io.Reader, size int64, mime string) error {
	s.gotTenant, s.gotPath = tenant, path
	_, _ = io.Copy(io.Discard, body)
	return s.uploadErr
}
func (s *stubStorageService) Download(ctx context.Context, tenant, path string) (io.ReadCloser, storage.ObjectMeta, error) {
	if s.downloadErr != nil {
		return nil, storage.ObjectMeta{}, s.downloadErr
	}
	return s.downloadRC, s.downloadMD, nil
}
func (s *stubStorageService) Stat(ctx context.Context, tenant, path string) (storage.ObjectRecord, error) {
	if s.statErr != nil {
		return storage.ObjectRecord{}, s.statErr
	}
	return storage.ObjectRecord{Name: path, SizeBytes: 10, MimeType: "text/plain"}, nil
}
func (s *stubStorageService) List(ctx context.Context, tenant, prefix string, limit int, cursor string) ([]storage.ObjectRecord, string, error) {
	return []storage.ObjectRecord{{Name: "a.txt", SizeBytes: 1, MimeType: "text/plain"}}, "", nil
}
func (s *stubStorageService) Delete(ctx context.Context, tenant, path string) error { return nil }
func (s *stubStorageService) Share(ctx context.Context, tenant, path string, ttl time.Duration) (string, time.Time, error) {
	if s.shareErr != nil {
		return "", time.Time{}, s.shareErr
	}
	return "tok123", time.Now().Add(ttl), nil
}
func (s *stubStorageService) Usage(ctx context.Context, tenant string) (storage.UsageInfo, error) {
	return storage.UsageInfo{UsedBytes: 42, AggregateLimit: 100 << 20, PerFileLimit: 25 << 20, Tier: "starter"}, nil
}
func (s *stubStorageService) Redeem(ctx context.Context, token string) (io.ReadCloser, storage.ObjectMeta, error) {
	if s.redeemErr != nil {
		return nil, storage.ObjectMeta{}, s.redeemErr
	}
	return io.NopCloser(strings.NewReader("shared-bytes")), storage.ObjectMeta{Size: 12, ContentType: "text/html"}, nil
}

func withTenant(r *http.Request, tenant string) *http.Request {
	ctx := auth.WithUser(r.Context(), &auth.UserContext{TenantID: tenant})
	return r.WithContext(ctx)
}

func routeWithWildcard(pattern string, h http.HandlerFunc, method, target string, r *http.Request) *httptest.ResponseRecorder {
	mux := chi.NewRouter()
	mux.Method(method, pattern, h)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, r)
	return rec
}

func TestStorageHandler_Upload_Created(t *testing.T) {
	stub := &stubStorageService{}
	h := NewStorageHandler(stub)

	r := httptest.NewRequest(http.MethodPut, "/v1/storage/objects/docs/readme.md", strings.NewReader("hello"))
	r.ContentLength = 5
	r = withTenant(r, "tn-a")
	rec := routeWithWildcard("/v1/storage/objects/*", h.Upload, http.MethodPut, "", r)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body)
	}
	if stub.gotTenant != "tn-a" || stub.gotPath != "docs/readme.md" {
		t.Errorf("service got (%q,%q), want (tn-a, docs/readme.md)", stub.gotTenant, stub.gotPath)
	}
}

func TestStorageHandler_Upload_LengthRequired(t *testing.T) {
	h := NewStorageHandler(&stubStorageService{})
	r := httptest.NewRequest(http.MethodPut, "/v1/storage/objects/f", http.NoBody)
	r.ContentLength = -1
	r = withTenant(r, "tn")
	rec := routeWithWildcard("/v1/storage/objects/*", h.Upload, http.MethodPut, "", r)
	if rec.Code != http.StatusLengthRequired {
		t.Errorf("status = %d, want 411", rec.Code)
	}
}

func TestStorageHandler_Upload_TypedStatusMapping(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"quota 402", &storage.QuotaExceededError{UsedBytes: 100, LimitBytes: 100, AddBytes: 5}, http.StatusPaymentRequired},
		{"too large 413", &storage.FileTooLargeError{SizeBytes: 99, MaxFileBytes: 10}, http.StatusRequestEntityTooLarge},
		{"bad path 400", storage.ErrInvalidPath, http.StatusBadRequest},
		{"backend 503", errors.New("s3 backend down"), http.StatusServiceUnavailable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := NewStorageHandler(&stubStorageService{uploadErr: tc.err})
			r := httptest.NewRequest(http.MethodPut, "/v1/storage/objects/f", strings.NewReader("x"))
			r.ContentLength = 1
			r = withTenant(r, "tn")
			rec := routeWithWildcard("/v1/storage/objects/*", h.Upload, http.MethodPut, "", r)
			if rec.Code != tc.want {
				t.Errorf("status = %d, want %d", rec.Code, tc.want)
			}
		})
	}
}

// TestStorageHandler_Download_EC2Headers is the EC-2 security regression: the
// stored (client-declared) Content-Type must NEVER render inline — nosniff +
// attachment are mandatory on download.
func TestStorageHandler_Download_EC2Headers(t *testing.T) {
	stub := &stubStorageService{
		downloadRC: io.NopCloser(strings.NewReader("<script>alert(1)</script>")),
		downloadMD: storage.ObjectMeta{Size: 25, ContentType: "text/html"},
	}
	h := NewStorageHandler(stub)
	r := withTenant(httptest.NewRequest(http.MethodGet, "/v1/storage/objects/evil.html", nil), "tn")
	rec := routeWithWildcard("/v1/storage/objects/*", h.Download, http.MethodGet, "", r)

	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment") {
		t.Errorf("Content-Disposition = %q, want attachment...", cd)
	}
}

// TestStorageHandler_DashboardMount_DownloadNestedObject is the regression for
// the Workspace file-preview 405: the dashboard BFF (/v1/dashboard/storage)
// mounted only List/Stat/Upload/Delete, so a GET to a nested object path matched
// the PUT/DELETE-only /objects/* pattern → 405 Method Not Allowed. The mount MUST
// expose GET /objects/* (Download) — the read-one the folder-browser preview and
// download actions call. This test exercises the REAL mount function main.go uses.
func TestStorageHandler_DashboardMount_DownloadNestedObject(t *testing.T) {
	stub := &stubStorageService{
		downloadRC: io.NopCloser(strings.NewReader("# hello")),
		downloadMD: storage.ObjectMeta{Size: 7, ContentType: "text/markdown"},
	}
	h := NewStorageHandler(stub)
	mux := chi.NewRouter()
	h.MountDashboardRoutes(mux)

	r := withTenant(httptest.NewRequest(http.MethodGet, "/objects/devteam/.claude/CLAUDE.md", nil), "tn")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, r)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET nested dashboard object: got %d, want 200 (405 = missing download route)", rec.Code)
	}
	if got := rec.Body.String(); got != "# hello" {
		t.Fatalf("body = %q, want the object bytes", got)
	}
}

// TestStorageHandler_Redeem_EC2Headers — same neutralization on the ONLY
// unauthenticated route + typed status for expired/invalid tokens.
func TestStorageHandler_Redeem_EC2Headers(t *testing.T) {
	h := NewStorageHandler(&stubStorageService{})
	r := httptest.NewRequest(http.MethodGet, "/v1/storage/shared/tok123", nil)
	rec := httptest.NewRecorder()
	mux := chi.NewRouter()
	mux.Get("/v1/storage/shared/{token}", h.RedeemShare)
	mux.ServeHTTP(rec, r)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Error("redemption must set nosniff (stored-XSS neutralization)")
	}
	if !strings.HasPrefix(rec.Header().Get("Content-Disposition"), "attachment") {
		t.Error("redemption must force attachment")
	}
}

func TestStorageHandler_Redeem_ExpiredAndInvalid(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want int
	}{
		{share.ErrExpired, http.StatusGone},
		{share.ErrInvalid, http.StatusForbidden},
	} {
		h := NewStorageHandler(&stubStorageService{redeemErr: tc.err})
		r := httptest.NewRequest(http.MethodGet, "/v1/storage/shared/x", nil)
		rec := httptest.NewRecorder()
		mux := chi.NewRouter()
		mux.Get("/v1/storage/shared/{token}", h.RedeemShare)
		mux.ServeHTTP(rec, r)
		if rec.Code != tc.want {
			t.Errorf("redeem %v → %d, want %d", tc.err, rec.Code, tc.want)
		}
	}
}

func TestStorageHandler_List_JSONShape(t *testing.T) {
	h := NewStorageHandler(&stubStorageService{})
	r := withTenant(httptest.NewRequest(http.MethodGet, "/v1/storage/objects?prefix=a", nil), "tn")
	rec := httptest.NewRecorder()
	mux := chi.NewRouter()
	mux.Get("/v1/storage/objects", h.List)
	mux.ServeHTTP(rec, r)

	var body struct {
		Files      []map[string]any `json:"files"`
		NextCursor string           `json:"next_cursor"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if len(body.Files) != 1 || body.Files[0]["path"] != "a.txt" {
		t.Errorf("files = %v, want one a.txt", body.Files)
	}
}

// TestStorageScopesRegistered locks the storage:read/storage:write scopes into
// the active registry (T2.1) — a regression here would silently 403 every
// storage request. storage:admin must NOT be customer-issuable (in-process
// vertical, no broker mint).
func TestStorageScopesRegistered(t *testing.T) {
	for _, s := range []string{"storage:read", "storage:write"} {
		if !validScopes[s] {
			t.Errorf("scope %q must be in the active validScopes registry", s)
		}
	}
	if validScopes["storage:admin"] {
		t.Error("storage:admin must NOT be customer-issuable")
	}
}

func TestStorageHandler_Usage(t *testing.T) {
	h := NewStorageHandler(&stubStorageService{})
	r := withTenant(httptest.NewRequest(http.MethodGet, "/v1/dashboard/storage/usage", nil), "tn")
	rec := httptest.NewRecorder()
	mux := chi.NewRouter()
	mux.Get("/v1/dashboard/storage/usage", h.Usage)
	mux.ServeHTTP(rec, r)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["used_bytes"].(float64) != 42 {
		t.Errorf("used_bytes = %v, want 42", body["used_bytes"])
	}
	if body["tier"] != "starter" {
		t.Errorf("tier = %v, want starter", body["tier"])
	}
}
