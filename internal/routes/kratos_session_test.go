package routes

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

type stubEnsurer struct {
	tid, aid       string
	err            error
	gotID, gotMail string
}

func (s *stubEnsurer) EnsureTenant(_ context.Context, id, email string) (string, string, string, error) {
	s.gotID, s.gotMail = id, email
	return s.tid, s.aid, "owner", s.err
}

// whoamiServer stands in for Kratos /sessions/whoami.
func whoamiServer(t *testing.T, status int, active bool, id, email string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/sessions/whoami" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if status == http.StatusOK {
			fmt.Fprintf(w, `{"active":%t,"identity":{"id":%q,"traits":{"email":%q}}}`, active, id, email)
		}
	}))
}

func TestKratosResolver_ActiveSession_ResolvesTenant(t *testing.T) {
	srv := whoamiServer(t, http.StatusOK, true, "usr_1", "a@b.com")
	defer srv.Close()
	ens := &stubEnsurer{tid: "t1", aid: "acc1"}
	r := NewKratosSessionTenantResolver(srv.URL, ens)

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.AddCookie(&http.Cookie{Name: "ory_kratos_session", Value: "sess"})
	aid, tid, ok := r.Resolve(req)

	if !ok || aid != "acc1" || tid != "t1" {
		t.Fatalf("want (acc1, t1, true), got (%q, %q, %v)", aid, tid, ok)
	}
	if ens.gotID != "usr_1" || ens.gotMail != "a@b.com" {
		t.Fatalf("EnsureTenant got wrong identity: id=%q email=%q", ens.gotID, ens.gotMail)
	}
}

func TestKratosResolver_NoSession_FailsClosed(t *testing.T) {
	srv := whoamiServer(t, http.StatusUnauthorized, false, "", "")
	defer srv.Close()
	r := NewKratosSessionTenantResolver(srv.URL, &stubEnsurer{tid: "t1", aid: "acc1"})
	if _, _, ok := r.Resolve(httptest.NewRequest(http.MethodGet, "/x", nil)); ok {
		t.Fatal("want ok=false when whoami returns 401")
	}
}

func TestKratosResolver_InactiveSession_FailsClosed(t *testing.T) {
	srv := whoamiServer(t, http.StatusOK, false, "usr_1", "a@b.com") // 200 but active=false
	defer srv.Close()
	r := NewKratosSessionTenantResolver(srv.URL, &stubEnsurer{tid: "t1", aid: "acc1"})
	if _, _, ok := r.Resolve(httptest.NewRequest(http.MethodGet, "/x", nil)); ok {
		t.Fatal("want ok=false when the session is inactive")
	}
}

func TestKratosResolver_EnsureTenantError_FailsClosed(t *testing.T) {
	srv := whoamiServer(t, http.StatusOK, true, "usr_1", "a@b.com")
	defer srv.Close()
	r := NewKratosSessionTenantResolver(srv.URL, &stubEnsurer{err: errors.New("db down")})
	if _, _, ok := r.Resolve(httptest.NewRequest(http.MethodGet, "/x", nil)); ok {
		t.Fatal("want ok=false (fail-closed) when EnsureTenant errors — never connect as an unknown tenant")
	}
}
