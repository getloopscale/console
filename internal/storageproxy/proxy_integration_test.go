// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

//go:build integration

// End-to-end proof of the strangler-fig: theo-cloud's real StorageHandler wired
// with the real storageproxy.Client, driving the full chain through chi routes
// against a REAL running theo-storage service (which itself hits real PG+MinIO).
// The only thing stubbed is theo-cloud's auth middleware (tenant injected), same
// as the in-process storage_integration_test.go. Run with:
//
//	THEO_STORAGE_URL=http://localhost:8080 \
//	go test -tags=integration ./internal/storageproxy/ -run E2E -v
package storageproxy

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/routes"
)

func injectTenant(next http.Handler, tenant string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := auth.WithUser(r.Context(), &auth.UserContext{TenantID: tenant})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func TestE2E_ProxyThroughToTheoStorage(t *testing.T) {
	up := os.Getenv("THEO_STORAGE_URL")
	if up == "" {
		t.Skip("THEO_STORAGE_URL not set — skipping proxy e2e (needs a running theo-storage)")
	}
	// Real handler over the real proxy over the real theo-storage.
	h := routes.NewStorageHandler(New(up, http.DefaultClient))
	const tenant = "tn-proxy-e2e"

	r := chi.NewRouter()
	r.Route("/v1/storage", func(r chi.Router) {
		r.Method(http.MethodPut, "/objects/*", injectTenant(http.HandlerFunc(h.Upload), tenant))
		r.Method(http.MethodGet, "/objects/*", injectTenant(http.HandlerFunc(h.Download), tenant))
		r.Method(http.MethodGet, "/objects", injectTenant(http.HandlerFunc(h.List), tenant))
		r.Method(http.MethodDelete, "/objects/*", injectTenant(http.HandlerFunc(h.Delete), tenant))
		r.Method(http.MethodPost, "/share", injectTenant(http.HandlerFunc(h.CreateShare), tenant))
		r.Get("/shared/{token}", h.RedeemShare) // unauthenticated
	})
	srv := httptest.NewServer(r)
	defer srv.Close()

	payload := []byte("theo-cloud handler → proxy → theo-storage → PG+MinIO")

	// PUT upload
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/v1/storage/objects/proxy/doc.txt", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "text/plain")
	req.ContentLength = int64(len(payload))
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload: status=%v err=%v", statusOf(resp), err)
	}
	resp.Body.Close()

	// GET download — bytes identical + EC-2 headers survive the proxy
	resp, err = http.Get(srv.URL + "/v1/storage/objects/proxy/doc.txt")
	if err != nil {
		t.Fatalf("download: %v", err)
	}
	got, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !bytes.Equal(got, payload) {
		t.Errorf("download bytes mismatch through proxy: %q", got)
	}
	if resp.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Error("nosniff (EC-2) lost through the proxy")
	}

	// share → redeem (unauthenticated) — bytes identical
	sresp, err := http.Post(srv.URL+"/v1/storage/share", "application/json",
		bytes.NewReader([]byte(`{"path":"proxy/doc.txt","expires_in_seconds":600}`)))
	if err != nil || sresp.StatusCode != http.StatusOK {
		t.Fatalf("share: status=%v err=%v", statusOf(sresp), err)
	}
	var share struct {
		URL string `json:"url"`
	}
	_ = json.NewDecoder(sresp.Body).Decode(&share)
	sresp.Body.Close()

	rresp, err := http.Get(srv.URL + share.URL)
	if err != nil || rresp.StatusCode != http.StatusOK {
		t.Fatalf("redeem: status=%v err=%v", statusOf(rresp), err)
	}
	rgot, _ := io.ReadAll(rresp.Body)
	rresp.Body.Close()
	if !bytes.Equal(rgot, payload) {
		t.Errorf("redeem bytes mismatch through proxy: %q", rgot)
	}

	// DELETE → subsequent GET is 404
	dreq, _ := http.NewRequest(http.MethodDelete, srv.URL+"/v1/storage/objects/proxy/doc.txt", nil)
	dresp, _ := http.DefaultClient.Do(dreq)
	if dresp.StatusCode != http.StatusNoContent {
		t.Errorf("delete = %d, want 204", dresp.StatusCode)
	}
	dresp.Body.Close()
	gresp, _ := http.Get(srv.URL + "/v1/storage/objects/proxy/doc.txt")
	if gresp.StatusCode != http.StatusNotFound {
		t.Errorf("get after delete = %d, want 404 (typed error survived proxy)", gresp.StatusCode)
	}
	gresp.Body.Close()

	_ = context.Background()
}

func statusOf(r *http.Response) int {
	if r == nil {
		return 0
	}
	return r.StatusCode
}
