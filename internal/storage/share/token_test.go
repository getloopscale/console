// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package share

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func fixedClock(ts int64) func() time.Time {
	return func() time.Time { return time.Unix(ts, 0).UTC() }
}

func TestMintRedeem_RoundTrip(t *testing.T) {
	s := New("secret-key", fixedClock(1000))
	tok := s.Mint("tn-abc", "avatars/x.png", 900*time.Second)

	claims, err := s.Redeem(tok)
	if err != nil {
		t.Fatalf("Redeem: %v", err)
	}
	if claims.TenantID != "tn-abc" {
		t.Errorf("tenant = %q, want tn-abc", claims.TenantID)
	}
	if claims.Path != "avatars/x.png" {
		t.Errorf("path = %q, want avatars/x.png", claims.Path)
	}
}

func TestRedeem_Expired(t *testing.T) {
	s := New("secret-key", fixedClock(1000))
	tok := s.Mint("tn-abc", "p", 60*time.Second) // expires at 1060

	s.now = fixedClock(1061) // 1s past expiry
	_, err := s.Redeem(tok)
	if err != ErrExpired {
		t.Errorf("Redeem past expiry = %v, want ErrExpired", err)
	}
}

func TestRedeem_TamperedSignature(t *testing.T) {
	s := New("secret-key", fixedClock(1000))
	tok := s.Mint("tn-abc", "p", 900*time.Second)

	// Tamper by decoding the signature, flipping a byte, and re-encoding — this
	// guarantees a changed signature (flipping the last base64 char alone can be
	// a no-op because its trailing bits are unused). Proves constant-time verify.
	parts := strings.Split(tok, ".")
	sig, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil {
		t.Fatalf("decode sig: %v", err)
	}
	sig[0] ^= 0x01
	tampered := parts[0] + "." + parts[1] + "." + parts[2] + "." + base64.RawURLEncoding.EncodeToString(sig)

	if _, err := s.Redeem(tampered); err != ErrInvalid {
		t.Errorf("Redeem tampered = %v, want ErrInvalid", err)
	}
}

func TestRedeem_TamperedPath(t *testing.T) {
	s := New("secret-key", fixedClock(1000))
	tok := s.Mint("tn-abc", "avatars/x.png", 900*time.Second)

	// Swap the path segment for a different (validly-encoded) path — the signature
	// no longer covers it. Proves a client cannot redirect a token to another object.
	parts := strings.Split(tok, ".")
	parts[1] = base64.RawURLEncoding.EncodeToString([]byte("secrets/other.png"))
	if _, err := s.Redeem(strings.Join(parts, ".")); err != ErrInvalid {
		t.Errorf("Redeem path-swapped = %v, want ErrInvalid", err)
	}
}

func TestRedeem_WrongSecret(t *testing.T) {
	minter := New("secret-A", fixedClock(1000))
	tok := minter.Mint("tn-abc", "p", 900*time.Second)

	verifier := New("secret-B", fixedClock(1000)) // rotated secret
	if _, err := verifier.Redeem(tok); err != ErrInvalid {
		t.Errorf("Redeem with rotated secret = %v, want ErrInvalid", err)
	}
}

func TestRedeem_Malformed(t *testing.T) {
	s := New("secret-key", fixedClock(1000))
	for _, bad := range []string{"", "no-dots", "only.one", "a.b.c.d.e"} {
		if _, err := s.Redeem(bad); err != ErrInvalid {
			t.Errorf("Redeem(%q) = %v, want ErrInvalid", bad, err)
		}
	}
}
