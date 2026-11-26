// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package storageproxy

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/getloopscale/loop-console/internal/storage"
	"github.com/getloopscale/loop-console/internal/storage/share"
)

// upstream is a minimal stand-in for the loopstore service. It records the
// last request (to assert header injection) and replays a scripted response.
type upstream struct {
	lastTenant string
	lastScopes string
	lastMethod string
	lastPath   string
	lastBody   []byte
	status     int
	respBody   string
	respHdr    map[string]string
}

func (u *upstream) server(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u.lastTenant = r.Header.Get("X-Theo-Tenant")
		u.lastScopes = r.Header.Get("X-Theo-Scopes")
		u.lastMethod = r.Method
		u.lastPath = r.URL.RequestURI()
		u.lastBody, _ = io.ReadAll(r.Body)
		for k, v := range u.respHdr {
			w.Header().Set(k, v)
		}
		if u.status == 0 {
			u.status = 200
		}
		w.WriteHeader(u.status)
		_, _ = io.WriteString(w, u.respBody)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func newClient(t *testing.T, u *upstream) *Client {
	return New(u.server(t).URL, http.DefaultClient)
}

func TestUpload_InjectsTenantAndForwardsBody(t *testing.T) {
	u := &upstream{status: http.StatusCreated}
	c := newClient(t, u)
	err := c.Upload(context.Background(), "tn-7", "docs/x.txt", strings.NewReader("payload"), 7, "text/plain")
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if u.lastTenant != "tn-7" {
		t.Errorf("X-Theo-Tenant = %q, want tn-7", u.lastTenant)
	}
	if !strings.Contains(u.lastScopes, "storage:write") {
		t.Errorf("X-Theo-Scopes = %q, want it to carry storage:write", u.lastScopes)
	}
	if u.lastMethod != http.MethodPut || u.lastPath != "/v1/storage/objects/docs/x.txt" {
		t.Errorf("forwarded %s %s, want PUT /v1/storage/objects/docs/x.txt", u.lastMethod, u.lastPath)
	}
	if string(u.lastBody) != "payload" {
		t.Errorf("forwarded body = %q, want payload", u.lastBody)
	}
}

func TestUpload_MapsQuotaAndTooLarge(t *testing.T) {
	c := newClient(t, &upstream{status: http.StatusPaymentRequired, respBody: `{"error":{"code":"storage_quota_exceeded"}}`})
	var qe *storage.QuotaExceededError
	if err := c.Upload(context.Background(), "t", "x", strings.NewReader("x"), 1, "text/plain"); !errors.As(err, &qe) {
		t.Errorf("402 mapped to %v, want *QuotaExceededError", err)
	}

	c2 := newClient(t, &upstream{status: http.StatusRequestEntityTooLarge, respBody: `{"error":{"code":"file_too_large"}}`})
	var fe *storage.FileTooLargeError
	if err := c2.Upload(context.Background(), "t", "x", strings.NewReader("x"), 1, "text/plain"); !errors.As(err, &fe) {
		t.Errorf("413 mapped to %v, want *FileTooLargeError", err)
	}
}

func TestDownload_StreamsBytesAndMeta(t *testing.T) {
	u := &upstream{
		status:   http.StatusOK,
		respBody: "the bytes",
		respHdr:  map[string]string{"Content-Type": "text/plain", "Content-Length": "9"},
	}
	c := newClient(t, u)
	rc, meta, err := c.Download(context.Background(), "tn-1", "a/b.txt")
	if err != nil {
		t.Fatalf("Download: %v", err)
	}
	defer func() { _ = rc.Close() }()
	got, _ := io.ReadAll(rc)
	if string(got) != "the bytes" {
		t.Errorf("body = %q, want 'the bytes'", got)
	}
	if meta.ContentType != "text/plain" || meta.Size != 9 {
		t.Errorf("meta = %+v, want {9 text/plain}", meta)
	}
	if u.lastTenant != "tn-1" {
		t.Errorf("tenant not injected on download: %q", u.lastTenant)
	}
}

func TestDownload_NotFound(t *testing.T) {
	c := newClient(t, &upstream{status: http.StatusNotFound, respBody: `{"error":{"code":"file_not_found"}}`})
	if _, _, err := c.Download(context.Background(), "t", "gone"); !errors.Is(err, storage.ErrObjectNotFoundMeta) {
		t.Errorf("404 mapped to %v, want ErrObjectNotFoundMeta", err)
	}
}

func TestStat_ParsesRecord(t *testing.T) {
	c := newClient(t, &upstream{status: 200, respBody: `{"path":"a/b.txt","size":42,"content_type":"text/plain"}`})
	rec, err := c.Stat(context.Background(), "t", "a/b.txt")
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if rec.Name != "a/b.txt" || rec.SizeBytes != 42 || rec.MimeType != "text/plain" {
		t.Errorf("rec = %+v", rec)
	}
}

func TestList_ParsesFilesAndCursor(t *testing.T) {
	c := newClient(t, &upstream{status: 200, respBody: `{"files":[{"path":"a","size":1,"content_type":"text/plain"},{"path":"b","size":2,"content_type":"text/plain"}],"next_cursor":"c2"}`})
	recs, next, err := c.List(context.Background(), "t", "", 100, "")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(recs) != 2 || recs[0].Name != "a" || next != "c2" {
		t.Errorf("recs=%+v next=%q", recs, next)
	}
}

func TestDelete_204(t *testing.T) {
	c := newClient(t, &upstream{status: http.StatusNoContent})
	if err := c.Delete(context.Background(), "t", "a"); err != nil {
		t.Errorf("Delete: %v", err)
	}
}

func TestShare_ExtractsTokenFromURL(t *testing.T) {
	c := newClient(t, &upstream{status: 200, respBody: `{"url":"/v1/storage/shared/TOKEN123","expires_at":"2026-07-14T21:00:00Z"}`})
	tok, exp, err := c.Share(context.Background(), "t", "a/b.txt", 0)
	if err != nil {
		t.Fatalf("Share: %v", err)
	}
	if tok != "TOKEN123" {
		t.Errorf("token = %q, want TOKEN123", tok)
	}
	if exp.IsZero() {
		t.Error("expires time not parsed")
	}
}

func TestRedeem_StreamsAndMapsExpiredInvalid(t *testing.T) {
	ok := newClient(t, &upstream{status: 200, respBody: "shared", respHdr: map[string]string{"Content-Type": "text/plain", "Content-Length": "6"}})
	rc, meta, err := ok.Redeem(context.Background(), "tok")
	if err != nil {
		t.Fatalf("Redeem: %v", err)
	}
	b, _ := io.ReadAll(rc)
	_ = rc.Close()
	if string(b) != "shared" || meta.Size != 6 {
		t.Errorf("redeem body=%q meta=%+v", b, meta)
	}

	exp := newClient(t, &upstream{status: http.StatusGone, respBody: `{"error":{"code":"share_expired"}}`})
	if _, _, err := exp.Redeem(context.Background(), "old"); !errors.Is(err, share.ErrExpired) {
		t.Errorf("410 mapped to %v, want share.ErrExpired", err)
	}
	inv := newClient(t, &upstream{status: http.StatusForbidden, respBody: `{"error":{"code":"share_invalid"}}`})
	if _, _, err := inv.Redeem(context.Background(), "bad"); !errors.Is(err, share.ErrInvalid) {
		t.Errorf("403 mapped to %v, want share.ErrInvalid", err)
	}
}

func TestUsage_ParsesCaps(t *testing.T) {
	c := newClient(t, &upstream{status: 200, respBody: `{"used_bytes":50,"aggregate_limit":100,"per_file_limit":25,"tier":"starter","unlimited":false}`})
	info, err := c.Usage(context.Background(), "t")
	if err != nil {
		t.Fatalf("Usage: %v", err)
	}
	if info.UsedBytes != 50 || info.AggregateLimit != 100 || info.PerFileLimit != 25 || info.Tier != "starter" {
		t.Errorf("info = %+v", info)
	}
}

func TestUpstreamError_Generic503Shape(t *testing.T) {
	// An unmapped 503 from upstream must surface as a non-typed error so the
	// handler maps it to 503 (its default branch).
	c := newClient(t, &upstream{status: http.StatusServiceUnavailable, respBody: `{"error":{"code":"storage_unavailable"}}`})
	err := c.Delete(context.Background(), "t", "a")
	if err == nil {
		t.Fatal("503 upstream should surface an error")
	}
	// Not one of the typed sentinels.
	if errors.Is(err, storage.ErrObjectNotFoundMeta) {
		t.Error("503 must not be mistaken for NotFound")
	}
}

// Compile-time proof the proxy satisfies the same interface the in-process
// service does (the shape routes.NewStorageHandler consumes).
var _ interface {
	Upload(ctx context.Context, tenantID, path string, body io.Reader, size int64, mime string) error
	Download(ctx context.Context, tenantID, path string) (io.ReadCloser, storage.ObjectMeta, error)
} = (*Client)(nil)
