package themory

import (
	"context"
	"net/http"
	"testing"
)

// skills-cross-repo-flat-list-gateway T1.1 — transport tests for the cross-repo
// flat skills listing. Skills are NOT in the openapi/themory.yaml subset, so
// these assert the request shape + decode directly (no openapi3filter), mirroring
// how the per-repo ListSkills is exercised.

func TestListSkillsAll_buildsSubjectAllPathWithQueryParams(t *testing.T) {
	var got *http.Request
	body := `{"skills":[{"id":"s1","hash":"h1","description":"alpha","code":"a","codeLanguage":"typescript","createdAt":"2026-06-01T00:00:00.000Z","derivedFrom":[],"supersededBy":null,"repoId":"repo-a"}],"total":3,"truncated":true}`
	srv := captureServer(t, http.StatusOK, body, &got)
	c := NewClient(srv.URL, "test-key", srv.Client())

	res, err := c.ListSkillsAll(context.Background(), "alice", SkillsAllOptions{Limit: 25, Offset: 10, Query: "csv"})
	if err != nil {
		t.Fatalf("ListSkillsAll: %v", err)
	}
	if got.URL.Path != "/v1/scopes/skill/alice/all" {
		t.Fatalf("unexpected path: %s", got.URL.Path)
	}
	if got.URL.Query().Get("limit") != "25" || got.URL.Query().Get("offset") != "10" || got.URL.Query().Get("q") != "csv" {
		t.Fatalf("unexpected query: %s", got.URL.RawQuery)
	}
	if res.Total != 3 || !res.Truncated {
		t.Fatalf("unexpected total/truncated: %d/%v", res.Total, res.Truncated)
	}
	if len(res.Skills) != 1 || res.Skills[0].RepoID != "repo-a" || res.Skills[0].Description != "alpha" {
		t.Fatalf("unexpected skills decode: %+v", res.Skills)
	}
}

func TestListSkillsAll_subjectIsPathEscaped(t *testing.T) {
	var got *http.Request
	srv := captureServer(t, http.StatusOK, `{"skills":[],"total":0,"truncated":false}`, &got)
	c := NewClient(srv.URL, "test-key", srv.Client())
	if _, err := c.ListSkillsAll(context.Background(), "a/b c", SkillsAllOptions{}); err != nil {
		t.Fatalf("ListSkillsAll: %v", err)
	}
	// PathEscape encodes the subject so the path stays well-formed.
	if got.URL.EscapedPath() != "/v1/scopes/skill/a%2Fb%20c/all" {
		t.Fatalf("subject not path-escaped: %s", got.URL.EscapedPath())
	}
	if got.URL.RawQuery != "" {
		t.Fatalf("expected no query params for empty opts, got %s", got.URL.RawQuery)
	}
}

func TestListSkillsAll_upstreamError_returnsError(t *testing.T) {
	var got *http.Request
	srv := captureServer(t, http.StatusInternalServerError, `{"error":"boom"}`, &got)
	c := NewClient(srv.URL, "test-key", srv.Client())
	if _, err := c.ListSkillsAll(context.Background(), "alice", SkillsAllOptions{}); err == nil {
		t.Fatal("expected an error on upstream 500, got nil")
	}
}

func TestListSkillsAll_nilSkillsCoalescedToEmpty(t *testing.T) {
	var got *http.Request
	srv := captureServer(t, http.StatusOK, `{"total":0,"truncated":false}`, &got)
	c := NewClient(srv.URL, "test-key", srv.Client())
	res, err := c.ListSkillsAll(context.Background(), "alice", SkillsAllOptions{})
	if err != nil {
		t.Fatalf("ListSkillsAll: %v", err)
	}
	if res.Skills == nil {
		t.Fatal("expected Skills coalesced to [], got nil")
	}
}
