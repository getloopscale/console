// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package storage

import (
	"errors"
	"strings"
)

// ErrInvalidPath is returned for a malformed object path. Handlers map it to
// HTTP 400. Validation happens at the boundary (error-handling.md § 2) BEFORE
// the path is used to derive an S3 key.
var ErrInvalidPath = errors.New("storage: invalid path")

const maxPathLen = 1024

// ValidatePath rejects object paths that are empty, absolute, contain parent/dot
// traversal, empty segments, trailing slashes, control characters, or exceed the
// length budget. A valid path is a '/'-joined set of non-empty segments none of
// which is "." or "..".
func ValidatePath(path string) error {
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
