// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/usetheodev/theo-cloud/internal/serviceversions"
)

// VersionCollector is the fan-out this BFF needs, declared on the consumer side so
// the handler can be tested without a network (architecture.md section 2). It is
// satisfied implicitly by *serviceversions.Collector.
type VersionCollector interface {
	Collect(ctx context.Context) serviceversions.Report
}

// ServiceVersionsHandler serves the dashboard's aggregate of data-plane versions.
//
// The browser cannot do this fan-out itself: it has a single relative origin, does
// not know the targets' base URLs (they exist only in this process) and must never
// hold the per-tenant credential. Hence a BFF (ADR D2).
type ServiceVersionsHandler struct {
	collector VersionCollector
	logger    *slog.Logger
}

// NewServiceVersionsHandler wires the collector into the HTTP surface. Both
// dependencies are required: every call site has a logger, so defaulting a nil one
// would be an untested branch guarding a case that does not occur (YAGNI).
func NewServiceVersionsHandler(c VersionCollector, logger *slog.Logger) *ServiceVersionsHandler {
	return &ServiceVersionsHandler{collector: c, logger: logger}
}

// Get returns the aggregate. It has no error path of its own by design: Collect
// does not return an error because every failure is already a typed state variant,
// so the "error" IS the domain value. Only a serialization failure is exceptional.
//
// r.Context() is handed to the collector so a browser that gives up cancels the
// in-flight probes (ADR D1).
func (h *ServiceVersionsHandler) Get(w http.ResponseWriter, r *http.Request) {
	report := h.collector.Collect(r.Context())

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(report); err != nil {
		// The status line is already sent; log rather than pretend we can 500.
		// Probe failures are logged once, in the collector — relogging them here
		// would duplicate without adding context (error-handling.md section 5).
		h.logger.Error("encode service versions", "error", err)
	}
}

// MountServiceVersions wires the read-only aggregate under /v1/dashboard/status
// behind requireJWT, like every other /v1/dashboard/* surface.
func MountServiceVersions(r chi.Router, h *ServiceVersionsHandler, requireJWT func(http.Handler) http.Handler) {
	r.Route("/v1/dashboard/status", func(r chi.Router) {
		r.Use(requireJWT)
		r.Get("/versions", h.Get)
	})
}
