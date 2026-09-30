// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/usetheoai/theo-cloud/internal/auth"
	"github.com/usetheoai/theo-cloud/internal/storage"
)

// usetheoai/theo#477 step 3: a dashboard route authenticated by the session
// cookie serves the tenant the cookie's identity belongs to — so the cookie of
// one tenant cannot reach an object of another, whatever the request names.

// ownedObjects holds one object per tenant; any other tenant gets not-found.
type ownedObjects struct {
	stubStorageService
	owner map[string]string // path -> tenant
}

func (o *ownedObjects) Stat(ctx context.Context, tenant, path string) (storage.ObjectRecord, error) {
	if o.owner[path] != tenant {
		return storage.ObjectRecord{}, storage.ErrObjectNotFoundMeta
	}
	return storage.ObjectRecord{Name: path, SizeBytes: 7, MimeType: "text/plain"}, nil
}

type identityTenants map[string]string

func (m identityTenants) EnsureTenant(_ context.Context, id, _ string) (string, string, string, error) {
	if t, ok := m[id]; ok {
		return t, "acct-" + t, "owner", nil
	}
	return "", "", "", errors.New("unknown identity")
}

func dashboardStorageRouter(t *testing.T) http.Handler {
	t.Helper()
	sessions := map[string]string{"cookie-of-a": "id-a", "cookie-of-b": "id-b"}
	kratos := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie("ory_kratos_session")
		if err != nil || sessions[c.Value] == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = fmt.Fprintf(w, `{"active":true,"identity":{"id":%q,"traits":{"email":"x@example.com"}}}`, sessions[c.Value])
	}))
	t.Cleanup(kratos.Close)

	authn := auth.NewKratosSessionAuthenticator(kratos.URL, identityTenants{"id-a": "tenant-a", "id-b": "tenant-b"})
	h := NewStorageHandler(&ownedObjects{owner: map[string]string{"reports/q3.pdf": "tenant-a"}})
	r := chi.NewRouter()
	r.Route("/v1/dashboard/storage", func(r chi.Router) {
		r.Use(auth.RequireCaller(nil, nil, authn))
		h.MountDashboardRoutes(r)
	})
	return r
}

func statObject(h http.Handler, cookie string) int {
	req := httptest.NewRequest(http.MethodGet, "/v1/dashboard/storage/stat/reports/q3.pdf", nil)
	req.AddCookie(&http.Cookie{Name: "ory_kratos_session", Value: cookie})
	req.Header.Set("X-Theo-Tenant", "tenant-a") // a client-side hint must change nothing
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w.Code
}

func TestDashboardStorage_TheOwningTenantsCookieReachesTheObject(t *testing.T) {
	if got := statObject(dashboardStorageRouter(t), "cookie-of-a"); got != http.StatusOK {
		t.Fatalf("status = %d, want 200 for the owning tenant", got)
	}
}

func TestDashboardStorage_AnotherTenantsCookieCannotReachTheObject(t *testing.T) {
	if got := statObject(dashboardStorageRouter(t), "cookie-of-b"); got != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 — tenant-b's session reached tenant-a's object", got)
	}
}
