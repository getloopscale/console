// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

// getloopscale/loopscale#477 step 1: loop-console is the single owner of the `loopscale-cli`
// client. Hydra grants a token audience only if it is registered on the
// client, so the RFC 8707 resources consent may grant (CONSENT_ALLOWED_RESOURCES)
// must be registered as audience too — one list feeds both.

type fakeHydraAdmin struct {
	clientExists bool
	createStatus int
	puts, posts  []map[string]any
}

func (f *fakeHydraAdmin) server(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		switch {
		case r.Method == http.MethodPut && r.URL.Path == "/admin/clients/loopscale-cli":
			f.puts = append(f.puts, body)
			if !f.clientExists {
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"error":"Unable to locate the resource"}`))
				return
			}
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodPost && r.URL.Path == "/admin/clients":
			f.posts = append(f.posts, body)
			status := f.createStatus
			if status == 0 {
				status = http.StatusCreated
			}
			w.WriteHeader(status)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func audienceOf(t *testing.T, payload map[string]any) []string {
	t.Helper()
	raw, ok := payload["audience"].([]any)
	if !ok {
		t.Fatalf("audience missing or wrong type: %T %v", payload["audience"], payload["audience"])
	}
	out := make([]string, len(raw))
	for i, v := range raw {
		out[i], _ = v.(string)
	}
	return out
}

func TestRegisterClient_RegistersTheAllowedResourcesAsAudience(t *testing.T) {
	admin := &fakeHydraAdmin{clientExists: true}
	c := NewHydraClient("", admin.server(t).URL, "loopscale-cli")

	err := c.RegisterClient([]string{"http://localhost:9876/auth"},
		[]string{"https://mcp.getloopscale.com", "loop-runtime-engine", "https://mcp.getloopscale.com"})

	if err != nil {
		t.Fatalf("RegisterClient: %v", err)
	}
	want := []string{"loop-console", "loop-runtime-engine", "https://mcp.getloopscale.com"}
	if got := audienceOf(t, admin.puts[0]); !reflect.DeepEqual(got, want) {
		t.Fatalf("audience = %v, want %v (base first, then each allowed resource once)", got, want)
	}
}

func TestRegisterClient_WithNoAllowedResourcesRegistersOnlyTheBaseAudiences(t *testing.T) {
	admin := &fakeHydraAdmin{clientExists: true}
	c := NewHydraClient("", admin.server(t).URL, "loopscale-cli")

	if err := c.RegisterClient(nil, nil); err != nil {
		t.Fatalf("RegisterClient: %v", err)
	}
	want := []string{"loop-console", "loop-runtime-engine"}
	if got := audienceOf(t, admin.puts[0]); !reflect.DeepEqual(got, want) {
		t.Fatalf("audience = %v, want exactly %v", got, want)
	}
}

func TestRegisterClient_CreatesTheClientWhenHydraDoesNotHaveIt(t *testing.T) {
	// A single owner must be able to CREATE the client, not only replace one
	// another writer created first.
	admin := &fakeHydraAdmin{clientExists: false}
	c := NewHydraClient("", admin.server(t).URL, "loopscale-cli")

	if err := c.RegisterClient(nil, []string{"https://mcp.getloopscale.com"}); err != nil {
		t.Fatalf("RegisterClient: %v", err)
	}
	if len(admin.posts) != 1 {
		t.Fatalf("POST /admin/clients called %d times, want 1", len(admin.posts))
	}
	if admin.posts[0]["client_id"] != "loopscale-cli" {
		t.Fatalf("created client_id = %v, want loopscale-cli", admin.posts[0]["client_id"])
	}
	want := []string{"loop-console", "loop-runtime-engine", "https://mcp.getloopscale.com"}
	if got := audienceOf(t, admin.posts[0]); !reflect.DeepEqual(got, want) {
		t.Fatalf("created audience = %v, want %v", got, want)
	}
}

func TestRegisterClient_ReportsAFailedCreate(t *testing.T) {
	admin := &fakeHydraAdmin{clientExists: false, createStatus: http.StatusInternalServerError}
	c := NewHydraClient("", admin.server(t).URL, "loopscale-cli")

	if err := c.RegisterClient(nil, nil); err == nil {
		t.Fatal("RegisterClient returned nil while Hydra refused to create the client")
	}
}
