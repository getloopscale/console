// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package storage

import (
	"errors"
	"testing"
)

func TestValidatePath(t *testing.T) {
	valid := []string{
		"file.txt",
		"avatars/user1.png",
		"a/b/c/deep.json",
		"with-dash_and.underscore.ext",
	}
	for _, p := range valid {
		if err := ValidatePath(p); err != nil {
			t.Errorf("ValidatePath(%q) = %v, want nil", p, err)
		}
	}

	invalid := []struct {
		path string
		why  string
	}{
		{"", "empty"},
		{"/leading", "leading slash"},
		{"../escape", "parent traversal"},
		{"a/../../etc/passwd", "traversal mid-path"},
		{"a/./b", "dot segment"},
		{"trailing/", "trailing slash"},
		{"has\x00null", "control char"},
		{"has\nnewline", "control char"},
		{"double//slash", "empty segment"},
	}
	for _, tc := range invalid {
		if err := ValidatePath(tc.path); !errors.Is(err, ErrInvalidPath) {
			t.Errorf("ValidatePath(%q) = %v, want ErrInvalidPath (%s)", tc.path, err, tc.why)
		}
	}
}

func TestValidatePath_MaxLength(t *testing.T) {
	long := make([]byte, maxPathLen+1)
	for i := range long {
		long[i] = 'a'
	}
	if err := ValidatePath(string(long)); !errors.Is(err, ErrInvalidPath) {
		t.Error("over-length path must be rejected")
	}
}
