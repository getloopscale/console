// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

//go:build integration

// HTTP-layer integration: the real StorageHandler over the real Service (real
// PGStore + real s3x/MinIO), driven through the actual chi routes via httptest.
// Proves the ENTIRE request path from HTTP down to real storage works — the only
// thing stubbed is the auth middleware (tenant injected directly), because that
// is exercised by the auth package's own tests. Run with the same env as the
// storage e2e (STORAGE_TEST_DATABASE_URL + S3X_TEST_*).
package routes

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/go-chi/chi/v5"
	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/storage"
)

func realHandler(t *testing.T) (*StorageHandler, *sql.DB) {
	t.Helper()
	dbURL := os.Getenv("STORAGE_TEST_DATABASE_URL")
	if dbURL == "" || os.Getenv("S3X_TEST_ENDPOINT") == "" {
		t.Skip("STORAGE_TEST_DATABASE_URL / S3X_TEST_ENDPOINT not set — skipping HTTP integration")
	}
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	svc, err := storage.BuildService(db, storage.BackendConfig{
		S3Endpoint:  os.Getenv("S3X_TEST_ENDPOINT"),
		S3Bucket:    os.Getenv("S3X_TEST_BUCKET"),
		S3Region:    "us-east-1",
		S3AccessKey: os.Getenv("S3X_TEST_ACCESS_KEY"),
		S3SecretKey: os.Getenv("S3X_TEST_SECRET_KEY"),
		ShareSecret: "this-is-a-32char-minimum-share-secret!",
	})
	if err != nil {
		t.Fatalf("BuildService: %v", err)
	}
	return NewStorageHandler(svc), db
}

// injectTenant mimics what RequireScope/requireJWT do — puts the tenant in ctx.
func injectTenant(next http.Handler, tenant string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := auth.WithUser(r.Context(), &auth.UserContext{TenantID: tenant})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func TestHTTP_StorageVertical_RealInfra(t *testing.T) {
	h, db := realHandler(t)
	defer db.Close()
	const tenant = "tn-http-itest"
	_, _ = db.Exec(`DELETE FROM storage_objects WHERE tenant_id = $1`, tenant)
	defer db.Exec(`DELETE FROM storage_objects WHERE tenant_id = $1`, tenant)

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

	payload := []byte("http → service → real PG + real MinIO")

	// PUT upload
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/v1/storage/objects/http/doc.txt", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "text/plain")
	req.ContentLength = int64(len(payload))
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusCreated {
		t.Fatalf("PUT upload: status=%v err=%v", statusOf(resp), err)
	}
	resp.Body.Close()

	// GET download — bytes identical + EC-2 headers present
	resp, err = http.Get(srv.URL + "/v1/storage/objects/http/doc.txt")
	if err != nil {
		t.Fatalf("GET download: %v", err)
	}
	got, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !bytes.Equal(got, payload) {
		t.Errorf("download bytes mismatch: %q", got)
	}
	if resp.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Error("download missing nosniff header (EC-2)")
	}
	if resp.Header.Get("Content-Disposition") == "" {
		t.Error("download missing Content-Disposition attachment (EC-2)")
	}

	// POST share → GET redeem (unauthenticated) — bytes identical + EC-2
	sresp, err := http.Post(srv.URL+"/v1/storage/share", "application/json",
		bytes.NewReader([]byte(`{"path":"http/doc.txt","expires_in_seconds":600}`)))
	if err != nil || sresp.StatusCode != http.StatusOK {
		t.Fatalf("POST share: status=%v err=%v", statusOf(sresp), err)
	}
	var share struct {
		URL string `json:"url"`
	}
	_ = json.NewDecoder(sresp.Body).Decode(&share)
	sresp.Body.Close()

	rresp, err := http.Get(srv.URL + share.URL)
	if err != nil || rresp.StatusCode != http.StatusOK {
		t.Fatalf("GET redeem: status=%v err=%v", statusOf(rresp), err)
	}
	rgot, _ := io.ReadAll(rresp.Body)
	rresp.Body.Close()
	if !bytes.Equal(rgot, payload) {
		t.Errorf("redeem bytes mismatch: %q", rgot)
	}
	if rresp.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Error("redemption missing nosniff (EC-2 on the unauthenticated route)")
	}

	// DELETE → subsequent GET is 404
	dreq, _ := http.NewRequest(http.MethodDelete, srv.URL+"/v1/storage/objects/http/doc.txt", nil)
	dresp, _ := http.DefaultClient.Do(dreq)
	if dresp.StatusCode != http.StatusNoContent {
		t.Errorf("DELETE status = %d, want 204", dresp.StatusCode)
	}
	dresp.Body.Close()
	gresp, _ := http.Get(srv.URL + "/v1/storage/objects/http/doc.txt")
	if gresp.StatusCode != http.StatusNotFound {
		t.Errorf("GET after delete = %d, want 404", gresp.StatusCode)
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
