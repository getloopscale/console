// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package s3x

import (
	"net/url"
	"strings"
	"testing"
	"time"
)

// fixedNow is the deterministic clock for the presign vector below.
var fixedNow = time.Date(2026, 1, 2, 15, 4, 5, 0, time.UTC)

// TestPresign_MatchesIndependentVector proves the query-string SigV4 presigner
// produces the signature computed by an INDEPENDENT reference implementation (a
// standalone Python SigV4 presign — the oracle, not our own code) for a fixed
// input. Signing security code MUST be validated against an independent oracle,
// not a self-referential golden (blueprint ADR D2 mitigation).
//
// Oracle input: method=PUT, endpoint=http://minio:9000, bucket=loopstore,
// key=tenant-x/data/report.txt, region=us-east-1, AK=AKIAEXAMPLE,
// SK=SECRETEXAMPLEKEY, expires=300s, X-Amz-Date=20260102T150405Z.
func TestPresign_MatchesIndependentVector(t *testing.T) {
	signer := &Signer{Region: "us-east-1", AccessKey: "AKIAEXAMPLE", SecretKey: "SECRETEXAMPLEKEY"}
	rawURL := "http://minio:9000/loopstore/tenant-x/data/report.txt"

	got, err := signer.Presign("PUT", rawURL, 300*time.Second, fixedNow)
	if err != nil {
		t.Fatalf("Presign: %v", err)
	}

	const wantSig = "905eee80694e9766e5ac63c80545429a71cae04ab62414bd1385d8c8ddca1745"
	const wantCanonicalQuery = "X-Amz-Algorithm=AWS4-HMAC-SHA256&" +
		"X-Amz-Credential=AKIAEXAMPLE%2F20260102%2Fus-east-1%2Fs3%2Faws4_request&" +
		"X-Amz-Date=20260102T150405Z&X-Amz-Expires=300&X-Amz-SignedHeaders=host"
	wantURL := rawURL + "?" + wantCanonicalQuery + "&X-Amz-Signature=" + wantSig

	if got != wantURL {
		t.Errorf("presigned URL mismatch\n got: %s\nwant: %s", got, wantURL)
	}
	if !strings.Contains(got, "X-Amz-Signature="+wantSig) {
		t.Errorf("signature not %s in %s", wantSig, got)
	}
}

// TestPresign_HasRequiredParams asserts every mandatory SigV4-presign query
// parameter is present (structural contract for any endpoint/key).
func TestPresign_HasRequiredParams(t *testing.T) {
	signer := &Signer{Region: "us-east-1", AccessKey: "AK", SecretKey: "SK"}
	u, err := signer.Presign("GET", "https://s3.example.com/bucket/tenant/a.bin", time.Minute, fixedNow)
	if err != nil {
		t.Fatalf("Presign: %v", err)
	}
	parsed, err := url.Parse(u)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	q := parsed.Query()
	for _, p := range []string{"X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date", "X-Amz-Expires", "X-Amz-SignedHeaders", "X-Amz-Signature"} {
		if q.Get(p) == "" {
			t.Errorf("missing required query param %s in %s", p, u)
		}
	}
	if q.Get("X-Amz-Algorithm") != "AWS4-HMAC-SHA256" {
		t.Errorf("X-Amz-Algorithm = %q", q.Get("X-Amz-Algorithm"))
	}
	if q.Get("X-Amz-SignedHeaders") != "host" {
		t.Errorf("X-Amz-SignedHeaders = %q, want host", q.Get("X-Amz-SignedHeaders"))
	}
	if q.Get("X-Amz-Expires") != "60" {
		t.Errorf("X-Amz-Expires = %q, want 60", q.Get("X-Amz-Expires"))
	}
}

// TestPresign_Deterministic proves the presigner is stateless: identical inputs
// yield identical URLs (safe for concurrent use).
func TestPresign_Deterministic(t *testing.T) {
	signer := &Signer{Region: "us-east-1", AccessKey: "AK", SecretKey: "SK"}
	a, _ := signer.Presign("PUT", "https://s3.example.com/b/k", time.Minute, fixedNow)
	b, _ := signer.Presign("PUT", "https://s3.example.com/b/k", time.Minute, fixedNow)
	if a != b {
		t.Errorf("presign not deterministic:\n%s\n%s", a, b)
	}
}

// TestPresign_RejectsBadURL asserts a malformed URL surfaces a typed error rather
// than a corrupt signature (fail-fast, error-handling.md).
func TestPresign_RejectsBadURL(t *testing.T) {
	signer := &Signer{Region: "us-east-1", AccessKey: "AK", SecretKey: "SK"}
	if _, err := signer.Presign("PUT", "://not-a-url", time.Minute, fixedNow); err == nil {
		t.Error("expected error for malformed URL, got nil")
	}
}

// TestClient_PresignUsesPublicEndpoint proves presigned URLs are signed against
// the browser-reachable PublicEndpoint (so the SigV4 host matches what the client
// hits) while the BFF's own server-side ops keep using the in-cluster Endpoint.
func TestClient_PresignUsesPublicEndpoint(t *testing.T) {
	c, err := New(Config{
		Endpoint: "http://minio:9000", PublicEndpoint: "https://storage-dev.getloopscale.com",
		Bucket: "loopstore", Region: "us-east-1", AccessKey: "AK", SecretKey: "SK",
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	url, err := c.PresignPut("tn/x.txt", time.Minute)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	if !strings.HasPrefix(url, "https://storage-dev.getloopscale.com/loopstore/tn/x.txt?") {
		t.Errorf("presign must use the public host, got %s", url)
	}
	if got := c.objectURL("tn/x.txt"); got != "http://minio:9000/loopstore/tn/x.txt" {
		t.Errorf("server-side url must stay in-cluster, got %s", got)
	}
}

// TestClient_PresignFallsBackToEndpoint proves an empty PublicEndpoint signs
// against Endpoint (single-host deployments unaffected).
func TestClient_PresignFallsBackToEndpoint(t *testing.T) {
	c, _ := New(Config{Endpoint: "http://minio:9000", Bucket: "b", Region: "us-east-1", AccessKey: "AK", SecretKey: "SK"})
	url, _ := c.PresignGet("k", time.Minute)
	if !strings.HasPrefix(url, "http://minio:9000/b/k?") {
		t.Errorf("no public endpoint should fall back to endpoint, got %s", url)
	}
}
