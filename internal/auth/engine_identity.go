// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package auth

import "net/http"

// Header names the engine (getloopscale/loop-runtime, api/internal/middleware/auth)
// reads on a service-authenticated call from this proxy. They are a wire
// contract with the engine: a name the engine does not read is an anonymous
// call, which it rejects with 401 "Invalid service authentication".
const (
	EngineUserIDHeader = "X-Loop-Runtime-User-ID"
	EngineTenantHeader = "X-Loop-Runtime-Tenant"
	EngineEmailHeader  = "X-Loop-Runtime-Email"
)

// SetEngineIdentity writes the caller's identity onto a request bound for the
// engine. The role is deliberately not sent: the engine resolves it from its
// own database and never trusts a role from a header (S2.3).
func SetEngineIdentity(h http.Header, u *UserContext) {
	h.Set(EngineUserIDHeader, u.Subject)
	h.Set(EngineTenantHeader, u.TenantID)
	h.Set(EngineEmailHeader, u.Email)
}
