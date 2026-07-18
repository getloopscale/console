// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package s3x

import (
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// PresignPut mints a presigned PUT URL for key, valid for expires. The client
// (a browser) uploads bytes directly to S3 with no BFF in the data path.
func (c *Client) PresignPut(key string, expires time.Duration) (string, error) {
	return c.signer.Presign(http.MethodPut, c.objectURL(key), expires, time.Now().UTC())
}

// PresignGet mints a presigned GET URL for key, valid for expires. The client
// downloads bytes directly from S3.
func (c *Client) PresignGet(key string, expires time.Duration) (string, error) {
	return c.signer.Presign(http.MethodGet, c.objectURL(key), expires, time.Now().UTC())
}

// Presign returns a query-string SigV4 presigned URL for method on rawURL, valid
// for expires from now. Only the `host` header is signed and the payload is
// UNSIGNED-PAYLOAD, so the returned URL can be used by any HTTP client (a browser
// PUT/GET) with no extra headers — the whole authorization travels in the query.
//
// This is the query-string variant of Signer.Sign (header-based): the derivation
// of the signing key and the canonicalization helpers are shared; only the
// placement of the X-Amz-* material (query vs header) and the fixed single signed
// header (`host`) differ. `now` is injected so the signature is deterministic and
// unit-testable against an independent oracle (presign_test.go).
func (s *Signer) Presign(method, rawURL string, expires time.Duration, now time.Time) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("s3x: presign parse url: %w", err)
	}
	if u.Host == "" {
		return "", fmt.Errorf("s3x: presign url missing host: %q", rawURL)
	}

	reqTime := now.UTC()
	date := reqTime.Format(dateFormat)
	dateTime := reqTime.Format(dateTimeFormat)
	scope := strings.Join([]string{date, s.Region, s3ServiceCode, terminationString}, "/")

	// SigV4-presign query parameters. X-Amz-Signature is NOT part of the signed set;
	// it is appended after the signature is computed.
	q := url.Values{}
	q.Set("X-Amz-Algorithm", signAlgorithm)
	q.Set("X-Amz-Credential", s.AccessKey+"/"+scope)
	q.Set("X-Amz-Date", dateTime)
	q.Set("X-Amz-Expires", strconv.Itoa(int(expires.Seconds())))
	q.Set("X-Amz-SignedHeaders", "host")

	canonicalQuery := escapeQuery(q)
	canonicalHeaders := "host:" + u.Host + "\n"
	const signedHeaders = "host"

	canonicalRequest := strings.Join([]string{
		method,
		escapePath(u.Path),
		canonicalQuery,
		canonicalHeaders,
		signedHeaders,
		unsignedPayload,
	}, "\n")

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

	// Base URL without any existing query (presign controls the whole query).
	base := u.Scheme + "://" + u.Host + escapePath(u.Path)
	return base + "?" + canonicalQuery + "&X-Amz-Signature=" + signature, nil
}
