// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package s3x

import (
	"net/http"
	"testing"
)

// TestSignV4_MatchesReferenceVector proves our hand-rolled SigV4 signer produces
// byte-identical Authorization headers to an independently-verified reference
// implementation (pocketbase's s3blob signer, itself tested against real S3/MinIO).
//
// Vector transcribed from the pinned clone pocketbase@089ca8a
// (tools/filesystem/internal/s3blob/s3/s3_test.go § "minimal"). Per plan T1.2 EC /
// blueprint ADR D2 mitigation: hand-rolled security code MUST validate against
// published/reference test vectors.
func TestSignV4_MatchesReferenceVector(t *testing.T) {
	signer := &Signer{
		Region:    "test_region",
		AccessKey: "123",
		SecretKey: "abc",
	}

	req, err := http.NewRequest(http.MethodGet, "https://test_bucket.example.com/test", nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("x-amz-date", "20250102T150405Z")

	signer.Sign(req)

	const wantAuth = "AWS4-HMAC-SHA256 Credential=123/20250102/test_region/s3/aws4_request, " +
		"SignedHeaders=host;x-amz-content-sha256;x-amz-date, " +
		"Signature=ea093662bc1deef08dfb4ac35453dfaad5ea89edf102e9dd3b7156c9a27e4c1f"

	if got := req.Header.Get("authorization"); got != wantAuth {
		t.Errorf("Authorization mismatch\n got: %s\nwant: %s", got, wantAuth)
	}
	if got := req.Header.Get("x-amz-content-sha256"); got != "UNSIGNED-PAYLOAD" {
		t.Errorf("x-amz-content-sha256 = %q, want UNSIGNED-PAYLOAD", got)
	}
	if got := req.Header.Get("host"); got != "test_bucket.example.com" {
		t.Errorf("host = %q, want test_bucket.example.com", got)
	}
}

// TestSignV4_Deterministic proves the signer is stateless/idempotent: signing two
// identical requests yields identical signatures (share-safe for concurrent use).
func TestSignV4_Deterministic(t *testing.T) {
	signer := &Signer{Region: "us-east-1", AccessKey: "AK", SecretKey: "SK"}

	sig := func() string {
		req, _ := http.NewRequest(http.MethodPut, "https://b.example.com/k", nil)
		req.Header.Set("x-amz-date", "20260101T000000Z")
		signer.Sign(req)
		return req.Header.Get("authorization")
	}
	if a, b := sig(), sig(); a != b {
		t.Errorf("non-deterministic signature:\n a=%s\n b=%s", a, b)
	}
}
