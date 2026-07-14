// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Package share mints and redeems short-lived HMAC-SHA256 tokens that grant
// read access to ONE stored object path. The token IS the authorization for the
// unauthenticated redemption route (blueprint ADR D1 / plan T2.5): a compact,
// stateless capability using only the stdlib (parsimony rung 2) with constant-time
// verification. Secret rotation invalidates outstanding tokens (documented).
package share

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"time"
)

var (
	// ErrExpired means the token's expiry has passed (HTTP 410 at the route).
	ErrExpired = errors.New("share: token expired")
	// ErrInvalid means the token is malformed or its signature does not verify
	// (HTTP 403). Malformed and bad-signature collapse to one error so redemption
	// leaks nothing about which check failed.
	ErrInvalid = errors.New("share: token invalid")
)

// Claims are the fields carried by a share token.
type Claims struct {
	TenantID string
	Path     string
	Expires  time.Time
}

// Signer mints and redeems tokens with a fixed service secret. now is injectable
// for deterministic tests (testing.md — no wall-clock in unit tests).
type Signer struct {
	secret []byte
	now    func() time.Time
}

// New returns a share.Signer. clock may be nil (defaults to time.Now UTC).
func New(secret string, clock func() time.Time) *Signer {
	if clock == nil {
		clock = func() time.Time { return time.Now().UTC() }
	}
	return &Signer{secret: []byte(secret), now: clock}
}

// Mint returns a token granting read access to (tenantID, path) until now+ttl.
// Format: base64url(tenant) "." base64url(path) "." expiryUnix "." base64url(sig).
func (s *Signer) Mint(tenantID, path string, ttl time.Duration) string {
	exp := s.now().Add(ttl).Unix()
	payload := s.payload(tenantID, path, exp)
	sig := s.sign(payload)
	return payload + "." + base64.RawURLEncoding.EncodeToString(sig)
}

// Redeem verifies a token and returns its claims. It checks the signature
// (constant-time) BEFORE expiry so a tampered token never reveals timing about
// the expiry field.
func (s *Signer) Redeem(token string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 4 {
		return Claims{}, ErrInvalid
	}
	payload := parts[0] + "." + parts[1] + "." + parts[2]
	gotSig, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil {
		return Claims{}, ErrInvalid
	}
	if !hmac.Equal(gotSig, s.sign(payload)) {
		return Claims{}, ErrInvalid
	}

	tenant, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return Claims{}, ErrInvalid
	}
	path, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrInvalid
	}
	expUnix, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil {
		return Claims{}, ErrInvalid
	}
	exp := time.Unix(expUnix, 0).UTC()
	if !s.now().Before(exp) {
		return Claims{}, ErrExpired
	}
	return Claims{TenantID: string(tenant), Path: string(path), Expires: exp}, nil
}

func (s *Signer) payload(tenantID, path string, exp int64) string {
	return base64.RawURLEncoding.EncodeToString([]byte(tenantID)) + "." +
		base64.RawURLEncoding.EncodeToString([]byte(path)) + "." +
		strconv.FormatInt(exp, 10)
}

func (s *Signer) sign(payload string) []byte {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(payload))
	return mac.Sum(nil)
}
