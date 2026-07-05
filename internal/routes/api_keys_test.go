package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/usetheodev/theo-cloud/internal/auth"
)

// authedCreateKeyRequest builds a POST /v1/api-keys request with an injected
// session user (Subject/TenantID/AccountID come from auth.GetUser, never the body).
func authedCreateKeyRequest(t *testing.T, name string, scopes []string) *http.Request {
	t.Helper()
	body, err := json.Marshal(map[string]any{"name": name, "scopes": scopes})
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	r := httptest.NewRequest(http.MethodPost, "/v1/api-keys", strings.NewReader(string(body)))
	return r.WithContext(auth.WithUser(r.Context(), &auth.UserContext{
		Subject:   "usr-test",
		TenantID:  "tn-test",
		AccountID: "acct-test",
	}))
}

// TestCreateKey_ScopeValidation is the scope-gate contract (#168): rag:read/write/
// delete are now ACTIVE (accepted → 200); reserved verticals (agents/deploys) still
// return 503 scope_not_yet_active; an unknown scope → 400; empty → 400; no user → 401.
func TestCreateKey_ScopeValidation(t *testing.T) {
	// Positive cases: an accepted scope proceeds to the INSERT → 200. The INSERT is
	// mocked; scope validation runs BEFORE it, so a failed validation never reaches here.
	for _, scope := range []string{"rag:read", "rag:write", "rag:delete"} {
		t.Run("accepts_"+scope, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock: %v", err)
			}
			defer db.Close()
			mock.ExpectExec("INSERT INTO theo_api_keys").
				WillReturnResult(sqlmock.NewResult(0, 1))

			h := NewAPIKeysHandler(db, nil)
			w := httptest.NewRecorder()
			h.CreateKey(w, authedCreateKeyRequest(t, "k", []string{scope}))

			if w.Code != http.StatusOK {
				t.Fatalf("scope %q: want 200, got %d (%s)", scope, w.Code, w.Body.String())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("scope %q: unmet sqlmock expectations: %v", scope, err)
			}
		})
	}

	// Negative cases: validation returns BEFORE the INSERT, so a sqlmock with no
	// expectations proves no DB op happened.
	negatives := []struct {
		name     string
		scopes   []string
		wantCode int
		wantErr  string // substring in the JSON error code
	}{
		{"reserved_agents", []string{"agents:read"}, http.StatusServiceUnavailable, "scope_not_yet_active"},
		{"reserved_deploys", []string{"deploys:write"}, http.StatusServiceUnavailable, "scope_not_yet_active"},
		// #168 anti-escalation (the crux): rag:admin is the broker-held key-lifecycle scope,
		// in NEITHER map, so it falls through to UNKNOWN_SCOPE — a customer can NEVER issue it.
		{"rejected_rag_admin", []string{"rag:admin"}, http.StatusBadRequest, "UNKNOWN_SCOPE"},
		{"unknown_scope", []string{"foo:bar"}, http.StatusBadRequest, "UNKNOWN_SCOPE"},
		{"empty_scopes", []string{}, http.StatusBadRequest, "EMPTY_SCOPES"},
	}
	for _, tc := range negatives {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock: %v", err)
			}
			defer db.Close()

			h := NewAPIKeysHandler(db, nil)
			w := httptest.NewRecorder()
			h.CreateKey(w, authedCreateKeyRequest(t, "k", tc.scopes))

			if w.Code != tc.wantCode {
				t.Fatalf("%s: want %d, got %d (%s)", tc.name, tc.wantCode, w.Code, w.Body.String())
			}
			if !strings.Contains(w.Body.String(), tc.wantErr) {
				t.Fatalf("%s: want error containing %q, got %s", tc.name, tc.wantErr, w.Body.String())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("%s: a DB op ran but should not have (validation precedes INSERT): %v", tc.name, err)
			}
		})
	}

	// Unauthenticated: no user in context → 401 (before any scope check).
	t.Run("unauthenticated", func(t *testing.T) {
		db, _, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock: %v", err)
		}
		defer db.Close()
		h := NewAPIKeysHandler(db, nil)
		w := httptest.NewRecorder()
		body, _ := json.Marshal(map[string]any{"name": "k", "scopes": []string{"rag:read"}})
		h.CreateKey(w, httptest.NewRequest(http.MethodPost, "/v1/api-keys", strings.NewReader(string(body))))
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("want 401, got %d (%s)", w.Code, w.Body.String())
		}
		if !strings.Contains(w.Body.String(), "AUTH_REQUIRED") {
			t.Fatalf("want AUTH_REQUIRED error code, got %s", w.Body.String())
		}
	})
}

// TestScopeMaps_RagGraduated locks the scope-map contract: rag data scopes are
// ACTIVE and NOT reserved; rag:admin is NEITHER (broker-held, never customer-issuable).
func TestScopeMaps_RagGraduated(t *testing.T) {
	for _, s := range []string{"rag:read", "rag:write", "rag:delete"} {
		if !validScopes[s] {
			t.Errorf("%q must be in validScopes (customer-issuable)", s)
		}
		if reservedScopes[s] {
			t.Errorf("%q must NOT be in reservedScopes", s)
		}
	}
	if validScopes["rag:admin"] || reservedScopes["rag:admin"] {
		t.Errorf("rag:admin must be in NEITHER map (broker-held key-lifecycle, not customer-issuable)")
	}
}
