// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package s3x

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func newTestClient(t *testing.T, srv *httptest.Server) *Client {
	t.Helper()
	c, err := New(Config{
		Endpoint:  srv.URL,
		Bucket:    "test-bucket",
		Region:    "us-east-1",
		AccessKey: "AK",
		SecretKey: "SK",
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	c.http = srv.Client()
	return c
}

func TestClient_PutObject(t *testing.T) {
	var gotMethod, gotPath, gotAuth string
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath, gotAuth = r.Method, r.URL.Path, r.Header.Get("authorization")
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	err := c.PutObject(context.Background(), "tenant-a/avatars/x.png", strings.NewReader("hello"), 5, "image/png")
	if err != nil {
		t.Fatalf("PutObject: %v", err)
	}
	if gotMethod != http.MethodPut {
		t.Errorf("method = %s, want PUT", gotMethod)
	}
	if gotPath != "/test-bucket/tenant-a/avatars/x.png" {
		t.Errorf("path = %s, want /test-bucket/tenant-a/avatars/x.png", gotPath)
	}
	if !strings.HasPrefix(gotAuth, "AWS4-HMAC-SHA256 ") {
		t.Errorf("missing SigV4 auth: %q", gotAuth)
	}
	if string(gotBody) != "hello" {
		t.Errorf("body = %q, want hello", gotBody)
	}
}

// TestClient_PutObject_EmptyBody is the 0-byte regression: an empty object
// (empty __init__.py / .gitkeep / placeholder) must PUT with a clean
// Content-Length: 0 and NO chunked Transfer-Encoding — chunked breaks S3/MinIO
// SigV4 single-payload signing and surfaces downstream as a 503 (observed during
// a real `theo storage sync` of a .claude/ with empty package markers).
func TestClient_PutObject_EmptyBody(t *testing.T) {
	var gotCL int64
	var gotTE []string
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotCL = r.ContentLength
		gotTE = r.TransferEncoding
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	// An ARBITRARY reader (io.NopCloser) of 0 bytes — NOT *strings.Reader, which
	// http.NewRequest auto-normalizes to http.NoBody. The real Upload path streams
	// through http.MaxBytesReader (also arbitrary), so this reproduces production.
	emptyArbitrary := io.NopCloser(strings.NewReader(""))
	if err := c.PutObject(context.Background(), "tenant-a/pkg/__init__.py", emptyArbitrary, 0, "text/x-python"); err != nil {
		t.Fatalf("PutObject(empty): %v", err)
	}
	if gotCL != 0 {
		t.Errorf("ContentLength = %d, want 0", gotCL)
	}
	if len(gotTE) != 0 {
		t.Errorf("TransferEncoding = %v, want none (chunked breaks S3 SigV4)", gotTE)
	}
	if len(gotBody) != 0 {
		t.Errorf("body = %q, want empty", gotBody)
	}
}

func TestClient_GetObject(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Content-Length", "5")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("world"))
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	rc, info, err := c.GetObject(context.Background(), "tenant-a/x")
	if err != nil {
		t.Fatalf("GetObject: %v", err)
	}
	defer func() { _ = rc.Close() }()
	body, _ := io.ReadAll(rc)
	if string(body) != "world" {
		t.Errorf("body = %q, want world", body)
	}
	if info.ContentType != "image/png" {
		t.Errorf("mime = %q, want image/png", info.ContentType)
	}
	if info.Size != 5 {
		t.Errorf("size = %d, want 5", info.Size)
	}
}

func TestClient_TypedErrors(t *testing.T) {
	cases := []struct {
		name   string
		status int
		want   error
	}{
		{"not found", http.StatusNotFound, ErrObjectNotFound},
		{"forbidden", http.StatusForbidden, ErrStorageAuth},
		{"server error", http.StatusInternalServerError, ErrStorageUnavailable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
			}))
			defer srv.Close()
			c := newTestClient(t, srv)
			_, _, err := c.GetObject(context.Background(), "k")
			if !errors.Is(err, tc.want) {
				t.Errorf("GetObject on %d = %v, want %v", tc.status, err, tc.want)
			}
		})
	}
}

func TestClient_HeadAndDelete(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodHead:
			w.Header().Set("Content-Length", "42")
			w.Header().Set("Content-Type", "text/plain")
			w.WriteHeader(http.StatusOK)
		case http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	info, err := c.HeadObject(context.Background(), "k")
	if err != nil {
		t.Fatalf("HeadObject: %v", err)
	}
	if info.Size != 42 {
		t.Errorf("size = %d, want 42", info.Size)
	}
	if err := c.DeleteObject(context.Background(), "k"); err != nil {
		t.Fatalf("DeleteObject: %v", err)
	}
}

// TestClient_ConcurrentPuts proves the client is share-safe (EC / plan T1.2
// concurrency requirement): 8 goroutines PUT distinct keys, -race clean.
func TestClient_ConcurrentPuts(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			key := "tenant/key-" + string(rune('a'+n))
			if err := c.PutObject(context.Background(), key, bytes.NewReader([]byte("x")), 1, "text/plain"); err != nil {
				t.Errorf("concurrent put %d: %v", n, err)
			}
		}(i)
	}
	wg.Wait()
}
