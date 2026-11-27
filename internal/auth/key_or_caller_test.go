// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestKeyOrCallerSendsAnAPIKeyToTheKeyGateAndTheRestToTheCallerGate(t *testing.T) {
	mark := func(name string) func(http.Handler) http.Handler {
		return func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("X-Gate", name)
				next.ServeHTTP(w, r)
			})
		}
	}
	handler := KeyOrCaller(mark("key"), mark("caller"))(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	for name, tc := range map[string]struct{ authorization, cookie, want string }{
		"an API key":                {authorization: "Bearer theo_live_abc", want: "key"},
		"a login token":             {authorization: "Bearer eyJhbGciOi.payload.sig", want: "caller"},
		"a session cookie":          {cookie: "ory_kratos_session=abc", want: "caller"},
		"no credential":             {want: "caller"},
		"an API key and a cookie":   {authorization: "Bearer theo_live_abc", cookie: "ory_kratos_session=abc", want: "key"},
		"a key outside a Bearer":    {authorization: "theo_live_abc", want: "caller"},
		"a key prefix inside a JWT": {authorization: "Bearer eyJ.theo_live_.sig", want: "caller"},
	} {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/v1/sandboxes", nil)
			if tc.authorization != "" {
				req.Header.Set("Authorization", tc.authorization)
			}
			if tc.cookie != "" {
				req.Header.Set("Cookie", tc.cookie)
			}
			rec := httptest.NewRecorder()

			handler.ServeHTTP(rec, req)

			if got := rec.Header().Get("X-Gate"); got != tc.want || rec.Code != http.StatusNoContent {
				t.Errorf("gate = %q, status = %d; want the %s gate and 204", got, rec.Code, tc.want)
			}
		})
	}
}
