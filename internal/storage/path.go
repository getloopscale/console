// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package storage

import (
	"errors"
	"net/url"
	"strings"
)

// ErrInvalidPath is returned for a malformed object path. Handlers map it to
// HTTP 400. Validation happens at the boundary (error-handling.md § 2) BEFORE
// the path is used to derive an S3 key.
var ErrInvalidPath = errors.New("storage: invalid path")

const maxPathLen = 1024

// maxUnescapePasses bounds the decode loop that closes the double-encoding hole (#195 F2). Two passes
// cover `%252f` → `%2f` → `/`; the third exists only so a deeper nesting is caught rather than
// silently accepted, and the bound exists so a crafted `%25%25%25…` cannot spin here.
const maxUnescapePasses = 3

// ValidatePath rejects object paths that are empty, absolute, contain parent/dot
// traversal, empty segments, trailing slashes, control characters, or exceed the
// length budget. A valid path is a '/'-joined set of non-empty segments none of
// which is "." or "..".
//
// It validates the path BOTH as written and as it would DECODE (theo-cloud#195). The router hands over
// the wildcard still percent-encoded, so `..%2f..%2fetc%2fpasswd` arrives as a SINGLE segment: it is not
// "..", it passed, reached the backend, and the failure surfaced as 503 `storage_unavailable` — an
// input-validation reject wearing the mask of backend health, which sends the operator to inspect S3
// over a malformed request. Every probed object stayed inside the caller's tenant prefix, so this is
// defense-in-depth and least-surprise, not a breach.
//
// The rule is deliberately narrow: reject when the DECODED form would be invalid. That catches injected
// separators, hidden `..` and control characters without rejecting a legitimate `%` — "crescimento-50%.txt"
// is a real filename, and a client that encodes a space is not attacking anyone.
func ValidatePath(path string) error {
	if err := validateLiteral(path); err != nil {
		return err
	}
	// Decode repeatedly: one pass leaves `%252f` as `%2f`, which is still an injected separator waiting
	// for whatever decodes next. Unescaping stops early on an invalid escape (`50%.txt`), and that is
	// the desired outcome — such a path is a literal, already judged above.
	decoded := path
	for i := 0; i < maxUnescapePasses; i++ {
		next, err := url.PathUnescape(decoded)
		if err != nil || next == decoded {
			break
		}
		decoded = next
		if err := validateLiteral(next); err != nil {
			return err
		}
	}
	return nil
}

// validateLiteral judges one concrete string. Split out so the same rules apply to the path as written
// and to every form it decodes into — duplicating them per form is how one of the two drifts.
func validateLiteral(path string) error {
	if path == "" || len(path) > maxPathLen {
		return ErrInvalidPath
	}
	if strings.HasPrefix(path, "/") || strings.HasSuffix(path, "/") {
		return ErrInvalidPath
	}
	for i := 0; i < len(path); i++ {
		if path[i] < 0x20 || path[i] == 0x7f {
			return ErrInvalidPath // control character
		}
	}
	for _, seg := range strings.Split(path, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return ErrInvalidPath
		}
	}
	return nil
}
