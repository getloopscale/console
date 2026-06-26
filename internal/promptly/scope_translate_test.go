// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package promptly

import (
	"reflect"
	"testing"
)

func TestScopeTranslate_PromptlyToPrompt(t *testing.T) {
	got := translateScopes([]string{"promptly:read", "promptly:write"})
	want := []string{"prompt:read", "prompt:write"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v want %v", got, want)
	}
}

func TestScopeTranslate_DropsForeignScopes(t *testing.T) {
	got := translateScopes([]string{"memory:read", "promptly:read", "prompt:write"})
	want := []string{"prompt:read"} // memory:* dropped; bare prompt:* (not promptly:) dropped
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v want %v", got, want)
	}
}

func TestScopeTranslate_NoPrivilegeEscalation(t *testing.T) {
	got := translateScopes([]string{"promptly:read"})
	for _, s := range got {
		if s == "prompt:write" || s == "prompt:admin" || s == "prompt:platform-admin" {
			t.Fatalf("read consumer escalated to %q", s)
		}
	}
}

func TestScopeTranslate_Empty(t *testing.T) {
	if got := translateScopes(nil); len(got) != 0 {
		t.Errorf("nil → %v, want empty", got)
	}
}
