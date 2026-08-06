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

	"github.com/usetheoai/theo-cloud/internal/auth"
	"github.com/usetheoai/theo-cloud/internal/metrics"
	"github.com/usetheoai/theo-cloud/internal/storage"
	"github.com/usetheoai/theo-cloud/internal/storage/share"
)

// stubStorageService lets us drive each handler branch deterministically.
type stubStorageService struct {
	uploadErr          error
	downloadRC         io.ReadCloser
	downloadMD         storage.ObjectMeta
	downloadErr        error
	statErr            error
	shareErr           error
	redeemErr          error
	gotTenant          string
	gotPath            string
	deleteErrByPath    map[string]error
	deletePrefixResult storage.BulkDeleteResult
	deletePrefixErr    error
	gotPrefixes        []string
	presignErr         error
	commitErr          error
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
func (s *stubStorageService) Delete(ctx context.Context, tenant, path string) error {
	s.gotTenant = tenant
	if s.deleteErrByPath != nil {
		if e, ok := s.deleteErrByPath[path]; ok {
			return e
		}
	}
	return nil
}
func (s *stubStorageService) DeletePrefix(ctx context.Context, tenant, prefix string) (storage.BulkDeleteResult, error) {
	s.gotTenant = tenant
	s.gotPrefixes = append(s.gotPrefixes, prefix)
	return s.deletePrefixResult, s.deletePrefixErr
}
func (s *stubStorageService) Share(ctx context.Context, tenant, path string, ttl time.Duration) (string, time.Time, error) {
	if s.shareErr != nil {
		return "", time.Time{}, s.shareErr
	}
	return "tok123", time.Now().Add(ttl), nil
}
func (s *stubStorageService) Usage(ctx context.Context, tenant string) (storage.UsageInfo, error) {
	return storage.UsageInfo{UsedBytes: 42, AggregateLimit: 100 << 20, PerFileLimit: 25 << 20, Tier: "starter"}, nil
}
func (s *stubStorageService) PresignUpload(ctx context.Context, tenant, path string, size int64, mime string) (string, time.Time, error) {
	s.gotTenant, s.gotPath = tenant, path
	if s.presignErr != nil {
		return "", time.Time{}, s.presignErr
	}
	return "https://s3.example/put/" + path + "?X-Amz-Signature=stub", time.Now().Add(5 * time.Minute), nil
}
func (s *stubStorageService) CommitUpload(ctx context.Context, tenant, path string) error {
	s.gotTenant, s.gotPath = tenant, path
	return s.commitErr
}
func (s *stubStorageService) PresignDownload(ctx context.Context, tenant, path string) (string, time.Time, error) {
	s.gotTenant, s.gotPath = tenant, path
	if s.presignErr != nil {
		return "", time.Time{}, s.presignErr
	}
	return "https://s3.example/get/" + path + "?X-Amz-Signature=stub", time.Now().Add(5 * time.Minute), nil
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

// --- T1.2: BulkDelete handler --------------------------------------------

func TestStorageHandler_BulkDelete_FilesAndFolders(t *testing.T) {
	stub := &stubStorageService{deletePrefixResult: storage.BulkDeleteResult{Deleted: 3, Freed: 30}}
	h := NewStorageHandler(stub)
	r := withTenant(httptest.NewRequest(http.MethodPost, "/bulk-delete", strings.NewReader(`{"paths":["a.txt"],"prefixes":["skills/"]}`)), "tn")
	rec := httptest.NewRecorder()
	h.BulkDelete(rec, r)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Deleted    int   `json:"deleted"`
		FreedBytes int64 `json:"freed_bytes"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Deleted != 4 {
		t.Errorf("deleted = %d, want 4 (1 path + 3 prefix)", resp.Deleted)
	}
	if stub.gotTenant != "tn" {
		t.Errorf("tenant = %q, want tn (from ctx, EC-1)", stub.gotTenant)
	}
}

func TestStorageHandler_BulkDelete_PartialFailure(t *testing.T) {
	stub := &stubStorageService{deleteErrByPath: map[string]error{"bad.txt": errors.New("503")}}
	h := NewStorageHandler(stub)
	r := withTenant(httptest.NewRequest(http.MethodPost, "/bulk-delete", strings.NewReader(`{"paths":["bad.txt"]}`)), "tn")
	rec := httptest.NewRecorder()
	h.BulkDelete(rec, r)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200 (partial failure is not a 5xx, D4)", rec.Code)
	}
	var resp struct {
		Deleted int `json:"deleted"`
		Failed  []struct {
			Path string `json:"path"`
		} `json:"failed"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Deleted != 0 || len(resp.Failed) != 1 || resp.Failed[0].Path != "bad.txt" {
		t.Errorf("got deleted=%d failed=%v, want deleted=0 failed=[bad.txt]", resp.Deleted, resp.Failed)
	}
}

func TestStorageHandler_BulkDelete_IdempotentOverlap(t *testing.T) {
	stub := &stubStorageService{
		deletePrefixResult: storage.BulkDeleteResult{Deleted: 1, Freed: 10},
		deleteErrByPath:    map[string]error{"a/b.txt": storage.ErrObjectNotFoundMeta},
	}
	h := NewStorageHandler(stub)
	r := withTenant(httptest.NewRequest(http.MethodPost, "/bulk-delete", strings.NewReader(`{"paths":["a/b.txt"],"prefixes":["a/"]}`)), "tn")
	rec := httptest.NewRecorder()
	h.BulkDelete(rec, r)
	var resp struct {
		Deleted int `json:"deleted"`
		Failed  []struct {
			Path string `json:"path"`
		} `json:"failed"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Failed) != 0 {
		t.Errorf("failed = %v, want none (not-found on overlap is idempotent success, D5/EC-1)", resp.Failed)
	}
	if resp.Deleted != 2 {
		t.Errorf("deleted = %d, want 2 (1 prefix + 1 idempotent path)", resp.Deleted)
	}
}

func TestStorageHandler_BulkDelete_RejectsPrefixWithoutSlash(t *testing.T) {
	h := NewStorageHandler(&stubStorageService{})
	r := withTenant(httptest.NewRequest(http.MethodPost, "/bulk-delete", strings.NewReader(`{"prefixes":["skills"]}`)), "tn")
	rec := httptest.NewRecorder()
	h.BulkDelete(rec, r)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("code = %d, want 400 (a folder prefix must end with /, EC-2)", rec.Code)
	}
}

func TestStorageHandler_BulkDelete_TooManyItems(t *testing.T) {
	paths := make([]string, bulkDeleteMaxItems+1)
	for i := range paths {
		paths[i] = "f"
	}
	b, _ := json.Marshal(map[string]any{"paths": paths})
	h := NewStorageHandler(&stubStorageService{})
	r := withTenant(httptest.NewRequest(http.MethodPost, "/bulk-delete", strings.NewReader(string(b))), "tn")
	rec := httptest.NewRecorder()
	h.BulkDelete(rec, r)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("code = %d, want 400 (over item cap)", rec.Code)
	}
}

func TestStorageHandler_BulkDelete_EmptyBody(t *testing.T) {
	h := NewStorageHandler(&stubStorageService{})
	r := withTenant(httptest.NewRequest(http.MethodPost, "/bulk-delete", strings.NewReader(`{}`)), "tn")
	rec := httptest.NewRecorder()
	h.BulkDelete(rec, r)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200 (empty body is a no-op)", rec.Code)
	}
	var resp struct {
		Deleted int `json:"deleted"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Deleted != 0 {
		t.Errorf("deleted = %d, want 0", resp.Deleted)
	}
}

func TestStorageHandler_DashboardMount_BulkDelete(t *testing.T) {
	// Regression: POST /bulk-delete must be reachable via the REAL dashboard mount.
	h := NewStorageHandler(&stubStorageService{})
	mux := chi.NewRouter()
	h.MountDashboardRoutes(mux)
	r := withTenant(httptest.NewRequest(http.MethodPost, "/bulk-delete", strings.NewReader(`{}`)), "tn")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, r)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /bulk-delete via mount: got %d, want 200 (not 404/405)", rec.Code)
	}
}

func TestStorageHandler_BulkDelete_MetricIncrements(t *testing.T) {
	before := metrics.ObjectsDeletedValue()
	stub := &stubStorageService{deletePrefixResult: storage.BulkDeleteResult{Deleted: 3}}
	h := NewStorageHandler(stub)
	r := withTenant(httptest.NewRequest(http.MethodPost, "/bulk-delete", strings.NewReader(`{"paths":["a.txt"],"prefixes":["skills/"]}`)), "tn")
	h.BulkDelete(httptest.NewRecorder(), r)
	if got := metrics.ObjectsDeletedValue() - before; got != 4 {
		t.Errorf("theo_storage_objects_deleted_total delta = %v, want 4 (1 path + 3 prefix)", got)
	}
}

// TestPresignEndpoints_M2M3 covers the presigned data-plane mounts: presign-upload
// mints a PUT URL, presign-download mints a GET URL, presign-commit finalizes; a
// commit for an un-uploaded object surfaces the typed 409.
func TestPresignEndpoints_M2M3(t *testing.T) {
	newMux := func(stub *stubStorageService) *chi.Mux {
		h := NewStorageHandler(stub)
		mux := chi.NewRouter()
		h.MountDashboardRoutes(mux)
		return mux
	}
	post := func(mux *chi.Mux, path, body string) *httptest.ResponseRecorder {
		r := withTenant(httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)), "tn-a")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, r)
		return rec
	}

	t.Run("presign-upload mints a PUT url", func(t *testing.T) {
		stub := &stubStorageService{}
		rec := post(newMux(stub), "/presign-upload", `{"path":"data/x.txt","size":10,"content_type":"text/plain"}`)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), `"method":"PUT"`) || !strings.Contains(rec.Body.String(), "X-Amz-Signature") {
			t.Errorf("response missing PUT url: %s", rec.Body.String())
		}
		if stub.gotPath != "data/x.txt" || stub.gotTenant != "tn-a" {
			t.Errorf("svc got (%q,%q), want (tn-a, data/x.txt)", stub.gotTenant, stub.gotPath)
		}
	})

	t.Run("presign-download mints a GET url", func(t *testing.T) {
		rec := post(newMux(&stubStorageService{}), "/presign-download", `{"path":"data/x.txt"}`)
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"method":"GET"`) {
			t.Fatalf("download mint: status %d body %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("presign-commit ok", func(t *testing.T) {
		rec := post(newMux(&stubStorageService{}), "/presign-commit", `{"path":"data/x.txt"}`)
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"committed":true`) {
			t.Fatalf("commit: status %d body %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("presign-commit un-uploaded → 409", func(t *testing.T) {
		stub := &stubStorageService{commitErr: &storage.UploadNotCompletedError{Path: "data/x.txt"}}
		rec := post(newMux(stub), "/presign-commit", `{"path":"data/x.txt"}`)
		if rec.Code != http.StatusConflict {
			t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "upload_not_completed") {
			t.Errorf("missing typed code: %s", rec.Body.String())
		}
	})

	t.Run("missing path → 400", func(t *testing.T) {
		rec := post(newMux(&stubStorageService{}), "/presign-upload", `{"size":10}`)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
	})
}

// TestStorageHandler_Upload_EncodedPathReachesServiceRaw — theo-cloud#195.
//
// Mede, em vez de deduzir, QUAL forma do nome chega ao serviço. Isso importa porque a correção do #195
// vive em `storage.ValidatePath`, e ela só fecha o buraco se a string que ela recebe for a que o caller
// escreveu. O achado LIVE (503 em vez de 400 para `..%2f..%2fetc%2fpasswd`) só é explicável se o
// wildcard chegar ainda PERCENT-ENCODED — um único segmento, que não é "..", e portanto passava.
//
// Se um dia o roteador passar a decodificar antes do handler, este teste muda de valor esperado e
// avisa; a validação continua correta nos dois mundos, porque julga a forma literal E as decodificadas.
func TestStorageHandler_Upload_EncodedPathReachesServiceRaw(t *testing.T) {
	stub := &stubStorageService{}
	h := NewStorageHandler(stub)
	mux := chi.NewRouter()
	h.MountDashboardRoutes(mux)

	const encoded = "..%2f..%2fetc%2fpasswd"
	r := withTenant(httptest.NewRequest(http.MethodPut, "/objects/"+encoded, strings.NewReader("x")), "tn")
	r.ContentLength = 1
	mux.ServeHTTP(httptest.NewRecorder(), r)

	if stub.gotPath == "" {
		t.Fatal("o serviço não foi chamado — a rota mudou e este teste perdeu o objeto de medida")
	}
	// A asserção que interessa não é a igualdade exata: é que o path NÃO chega decodificado em
	// separadores reais, porque é isso que torna o percent-encoding invisível para uma validação que
	// só olha segmentos.
	if strings.Contains(stub.gotPath, "/") {
		t.Fatalf("path chegou com separador real (%q) — o roteador decodificou; revisar a premissa do #195", stub.gotPath)
	}
	// E a ponta final: essa mesma string é rejeitada pela validação (400 invalid_path), que é o que o
	// #195 pedia em lugar do 503.
	if err := storage.ValidatePath(stub.gotPath); !errors.Is(err, storage.ErrInvalidPath) {
		t.Fatalf("ValidatePath(%q) = %v, quero ErrInvalidPath", stub.gotPath, err)
	}
	if got := statusForStorageErr(storage.ErrInvalidPath); got != http.StatusBadRequest {
		t.Fatalf("mapeamento HTTP = %d, quero 400", got)
	}
}
