// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// Package s3x is a minimal, hand-rolled S3-compatible client for LoopScale's tenant
// blob storage. It implements only the operations the storage vertical needs
// (put/get/head/delete) with AWS Signature v4, avoiding the ~18-module
// aws-sdk-go-v2 dependency tree (blueprint ADR D2 — fork-and-own, following the
// pocketbase precedent). The SigV4 signer is validated against reference test
// vectors (sign_test.go) since it is security code.
package s3x

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

const (
	signAlgorithm     = "AWS4-HMAC-SHA256"
	s3ServiceCode     = "s3"
	terminationString = "aws4_request"
	dateTimeFormat    = "20060102T150405Z"
	dateFormat        = "20060102"
	unsignedPayload   = "UNSIGNED-PAYLOAD"
)

// Signer signs *http.Request values per AWS Signature v4 for an S3-compatible
// endpoint. It holds no mutable state, so a single Signer is safe for concurrent
// use across goroutines.
type Signer struct {
	Region    string
	AccessKey string
	SecretKey string
}

// Sign adds the SigV4 Authorization header (and the x-amz-* headers it covers)
// to req in place. Payloads are signed as UNSIGNED-PAYLOAD; integrity is delegated
// to TLS + Content-Length, matching the pocketbase reference behavior.
func (s *Signer) Sign(req *http.Request) {
	if req.Header.Get("Accept-Encoding") == "" {
		req.Header.Set("Accept-Encoding", "identity")
	}
	if req.Header.Get("x-amz-content-sha256") == "" {
		req.Header.Set("x-amz-content-sha256", unsignedPayload)
	}

	reqTime, _ := time.Parse(dateTimeFormat, req.Header.Get("x-amz-date"))
	if reqTime.IsZero() {
		reqTime = time.Now().UTC()
		req.Header.Set("x-amz-date", reqTime.Format(dateTimeFormat))
	}
	req.Header.Set("host", req.URL.Host)

	date := reqTime.Format(dateFormat)
	dateTime := reqTime.Format(dateTimeFormat)

	canonicalHeaders, signedHeaders := canonicalAndSignedHeaders(req)
	canonicalRequest := strings.Join([]string{
		req.Method,
		escapePath(req.URL.Path),
		escapeQuery(req.URL.Query()),
		canonicalHeaders,
		signedHeaders,
		req.Header.Get("x-amz-content-sha256"),
	}, "\n")

	scope := strings.Join([]string{date, s.Region, s3ServiceCode, terminationString}, "/")
	stringToSign := strings.Join([]string{
		signAlgorithm,
		dateTime,
		scope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")

	dateKey := hmacSHA256([]byte("AWS4"+s.SecretKey), date)
	dateRegionKey := hmacSHA256(dateKey, s.Region)
	dateRegionServiceKey := hmacSHA256(dateRegionKey, s3ServiceCode)
	signingKey := hmacSHA256(dateRegionServiceKey, terminationString)
	signature := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))

	req.Header.Set("authorization", fmt.Sprintf(
		"%s Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		signAlgorithm, s.AccessKey, scope, signedHeaders, signature,
	))
}

func canonicalAndSignedHeaders(req *http.Request) (canonical, signed string) {
	names := make([]string, 0, len(req.Header))
	values := make(map[string]string, len(req.Header))
	for key, vals := range req.Header {
		lower := strings.ToLower(key)
		if lower != "host" && lower != "content-type" && !strings.HasPrefix(lower, "x-amz-") {
			continue
		}
		names = append(names, lower)
		trimmed := make([]string, len(vals))
		for i, v := range vals {
			trimmed[i] = strings.TrimSpace(v)
		}
		values[lower] = strings.Join(trimmed, ",")
	}
	sort.Strings(names)

	var b strings.Builder
	for _, n := range names {
		b.WriteString(n)
		b.WriteByte(':')
		b.WriteString(values[n])
		b.WriteByte('\n')
	}
	return b.String(), strings.Join(names, ";")
}

func sha256Hex(content []byte) string {
	h := sha256.Sum256(content)
	return hex.EncodeToString(h[:])
}

func hmacSHA256(key []byte, content string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(content))
	return mac.Sum(nil)
}

// escapePath URI-encodes a path per the SigV4 canonical-request rules, preserving
// '/' as a segment separator.
func escapePath(path string) string {
	if path == "" {
		return "/"
	}
	segments := strings.Split(path, "/")
	for i, seg := range segments {
		segments[i] = uriEncode(seg, false)
	}
	return strings.Join(segments, "/")
}

// escapeQuery builds the canonical query string: sorted keys, URI-encoded k=v.
func escapeQuery(values url.Values) string {
	if len(values) == 0 {
		return ""
	}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		vs := values[k]
		sort.Strings(vs)
		for _, v := range vs {
			parts = append(parts, uriEncode(k, true)+"="+uriEncode(v, true))
		}
	}
	return strings.Join(parts, "&")
}

// uriEncode implements AWS's UriEncode: unreserved chars pass through; everything
// else is %-encoded. When encodeSlash is false, '/' is preserved (path segments
// already split on it).
func uriEncode(s string, encodeSlash bool) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '.' || c == '_' || c == '~':
			b.WriteByte(c)
		case c == '/' && !encodeSlash:
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}
