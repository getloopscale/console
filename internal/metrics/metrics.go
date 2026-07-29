// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Package metrics provides Prometheus-native observability for the cloud service.
// §4.1 + §4.2: Auth and billing metrics exposed via /metrics endpoint.
//
// Migrated from manual sync/atomic counters to prometheus/client_golang.
// The public API (Inc*, Observe* functions) is preserved for all call sites.
package metrics

import (
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	dto "github.com/prometheus/client_model/go"
)

var (
	// Auth metrics (§4.1)
	tokenExchanges = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "theo_auth_token_exchanges_total",
		Help: "Token exchanges by result.",
	}, []string{"result"})

	deviceFlows = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "theo_auth_device_flow_total",
		Help: "Device flow completions.",
	}, []string{"result"})

	// Plan 2026-06-05-dashboard-journey-j05-device-success T3.1 D4:
	// Browser-side success signal — incremented when /v1/telemetry/events
	// receives event=device_success_viewed from the dashboard beacon.
	// Powers SLO "CLI auth completion rate" (ratio against successful
	// device-flow token grants in `theo_auth_device_flow_total{result=success}`).
	deviceFlowBrowserSuccess = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "theo_device_flow_browser_success_total",
		Help: "Device-flow consent confirmations rendered in the dashboard.",
	})

	// M7 tenant blob storage: bytes committed to the store. A pure counter (no
	// tenant label — cardinality discipline; per-tenant usage lives in
	// cost_counters + is logged for ops).
	storageBytesWritten = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "theo_storage_bytes_written_total",
		Help: "Total bytes committed to tenant blob storage.",
	})

	storageObjectsDeleted = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "theo_storage_objects_deleted_total",
		Help: "Total objects removed from tenant blob storage (incl. bulk/folder deletes).",
	})

	// M135 — every alert-rule visit, INCLUDING the paths that skip. A rule that stops evaluating
	// and says nothing is the operational twin of theo-cloud#247: #247 claimed something was wrong
	// when nothing was; a silent skip claims nothing is wrong when everything is. No tenant label —
	// cardinality discipline, matching storageBytesWritten above.
	// M21: one observation per /v1/version probe of a data-plane service. Both
	// labels come from closed sets — `service` from the fixed target list built at
	// the composition root, `result` from the four ServiceStatus states — so the
	// series ceiling is targets x states and no user input reaches a label.
	serviceVersionProbe = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "theo_cloud_service_version_probe_total",
		Help: "One observation per /v1/version probe. result is one of ok / unreachable / timeout / not_deployed.",
	}, []string{"service", "result"})

	lensAlertEvaluation = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "theo_lens_alert_evaluation_total",
		Help: "Alert-rule evaluations by result (ok|no_data|fetch_error|bulkhead_skipped|guard_missing|write_lost|unwired).",
	}, []string{"result"})

	tenantProvisioning = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "theo_tenant_provisioning_total",
		Help: "Tenant provisioning operations.",
	}, []string{"result"})

	tenantProvisioningDuration = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "theo_tenant_provisioning_duration_seconds",
		Help:    "Tenant provisioning duration in seconds.",
		Buckets: []float64{0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0},
	})

	authRejections = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "theo_auth_rejections_total",
		Help: "Auth rejections by reason.",
	}, []string{"reason"})

	// J-16 slice 3: deploy-event webhook delivery outcome (MEET-2026-07-03-005
	// wiring triad). result ∈ delivered | failed | dead_letter.
	workspaceWebhookDelivery = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "theo_workspace_webhook_delivery_total",
		Help: "Deploy-event webhook delivery attempts by outcome.",
	}, []string{"result"})

	// J-16 slice 3: SSRF-guard rejections at delivery dial time. ANY non-zero
	// value in prod is a probe/misconfig signal worth a log correlation
	// (MEET-2026-07-03-005). reason ∈ loopback | link_local | rfc1918_ula | …
	workspaceWebhookSSRFRejected = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "theo_workspace_webhook_ssrf_rejected_total",
		Help: "Webhook delivery dials rejected by the SSRF egress guard, by reason.",
	}, []string{"reason"})
	// J-16 slice 3: deploy-event webhook fan-out (MEET-2026-07-03-005 wiring triad).
	workspaceWebhookEnqueued = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "theo_workspace_webhook_enqueued_total",
		Help: "Deploy-event webhook deliveries enqueued by the fan-out, by event type.",
	}, []string{"event_type"})

	// Billing metrics (§4.2)
	webhookEvents = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "theo_webhook_events_total",
		Help: "Webhook events by status.",
	}, []string{"status"})

	checkoutOps = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "theo_billing_checkout_total",
		Help: "Checkout operations.",
	}, []string{"result"})

	usageDrift = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "theo_usage_drift_detected_total",
		Help: "Usage drift detection events.",
	})

	subscriptionFallback = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "theo_subscription_fallback_total",
		Help: "Subscription missing -- defaulted to starter.",
	})

	// Plan J-09 T1.1 (2026-06-05): GitHub App install + update callback counter.
	// Labelled by setup_action (install | update) so SLOs can distinguish
	// fresh provisioning from re-permission flows.
	githubAppInstallations = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "theo_github_app_installations_total",
		Help: "GitHub App install callback completions by setup_action.",
	}, []string{"setup_action"})

	// HTTP metrics (added with OTel instrumentation)
	httpRequestDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "theo_cloud_http_request_duration_seconds",
		Help:    "HTTP request duration in seconds.",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "path", "status_code"})
)

func init() {
	prometheus.MustRegister(
		tokenExchanges,
		deviceFlows,
		deviceFlowBrowserSuccess,
		storageBytesWritten,
		storageObjectsDeleted,
		lensAlertEvaluation,
		serviceVersionProbe,
		tenantProvisioning,
		tenantProvisioningDuration,
		authRejections,
		workspaceWebhookDelivery,
		workspaceWebhookSSRFRejected,
		workspaceWebhookEnqueued,
		webhookEvents,
		checkoutOps,
		usageDrift,
		subscriptionFallback,
		githubAppInstallations,
		httpRequestDuration,
	)
}

// IncWorkspaceWebhookEnqueued counts one deploy-event delivery enqueued by the
// fan-out (J-16 slice 3), labeled by the deploy event type.
func IncWorkspaceWebhookEnqueued(eventType string) {
	workspaceWebhookEnqueued.WithLabelValues(eventType).Inc()
}

// AddStorageBytes records delta bytes committed to tenant blob storage (M7).
func AddStorageBytes(delta int64) {
	if delta > 0 {
		storageBytesWritten.Add(float64(delta))
	}
}

// StorageBytesWrittenValue returns the current counter value (test-only helper).
// Uses the prometheus Write API (no testutil dependency).
func StorageBytesWrittenValue() float64 {
	var m dto.Metric
	if err := storageBytesWritten.Write(&m); err != nil {
		return 0
	}
	return m.GetCounter().GetValue()
}

// AddObjectsDeleted records n objects removed from tenant blob storage (bulk/folder delete).
func AddObjectsDeleted(n int) {
	if n > 0 {
		storageObjectsDeleted.Add(float64(n))
	}
}

// ObjectsDeletedValue returns the current counter value (test-only helper).
func ObjectsDeletedValue() float64 {
	var m dto.Metric
	if err := storageObjectsDeleted.Write(&m); err != nil {
		return 0
	}
	return m.GetCounter().GetValue()
}

// IncLensAlertEvaluation records one alert-rule visit. `result` is one of ok / no_data /
// fetch_error / guard_missing / unwired. Sustained fetch_error is the page-worthy signal: it means
// rules the customer believes are armed are not being evaluated at all.
func IncLensAlertEvaluation(result string) {
	lensAlertEvaluation.WithLabelValues(result).Inc()
}

// IncServiceVersionProbe records one /v1/version probe outcome. `result` is one of
// ok / unreachable / timeout / not_deployed. Sustained unreachable or timeout on a
// service the operator believes is up is the actionable signal: it is exactly the
// state the sidebar used to render as a hardcoded green "Operational".
func IncServiceVersionProbe(service, result string) {
	serviceVersionProbe.WithLabelValues(service, result).Inc()
}

// ServiceVersionProbeValue returns the current value of one labelled series
// (test-only helper, in the shape of ObjectsDeletedValue above). It is what lets a
// test prove the probe counter is non-zero rather than merely compiling.
func ServiceVersionProbeValue(service, result string) float64 {
	var m dto.Metric
	c, err := serviceVersionProbe.GetMetricWithLabelValues(service, result)
	if err != nil {
		return 0
	}
	if err := c.Write(&m); err != nil {
		return 0
	}
	return m.GetCounter().GetValue()
}

// IncTokenExchange increments token exchange counter.
func IncTokenExchange(success bool) {
	if success {
		tokenExchanges.WithLabelValues("success").Inc()
	} else {
		tokenExchanges.WithLabelValues("error").Inc()
	}
}

// IncDeviceFlow increments device flow counter.
func IncDeviceFlow(success bool) {
	if success {
		deviceFlows.WithLabelValues("success").Inc()
	} else {
		deviceFlows.WithLabelValues("error").Inc()
	}
}

// IncDeviceFlowBrowserSuccess increments when the dashboard renders the
// /device-success confirmation page (Plan J-05 T3.1 D4). Caller MUST gate
// this on the parsed event being `device_success_viewed` (EC-3 ordering
// invariant: never increment on rejected payloads).
func IncDeviceFlowBrowserSuccess() {
	deviceFlowBrowserSuccess.Inc()
}

// ObserveTenantProvisioning records a tenant provisioning operation.
func ObserveTenantProvisioning(success bool, duration time.Duration) {
	tenantProvisioningDuration.Observe(duration.Seconds())
	if success {
		tenantProvisioning.WithLabelValues("success").Inc()
	} else {
		tenantProvisioning.WithLabelValues("error").Inc()
	}
}

// IncAuthRejection increments auth rejection counter by reason.
func IncAuthRejection(reason string) {
	authRejections.WithLabelValues(reason).Inc()
}

// IncWorkspaceWebhookSSRFRejected counts one webhook delivery dial rejected by
// the SSRF guard (J-16 slice 3), labeled by DisallowedReason. Wired as the
// safehttp rejection observer.
func IncWorkspaceWebhookSSRFRejected(reason string) {
	workspaceWebhookSSRFRejected.WithLabelValues(reason).Inc()
}

// IncWorkspaceWebhookDelivery counts one deploy-event delivery outcome
// (J-16 slice 3). result MUST be one of "delivered", "failed", "dead_letter".
func IncWorkspaceWebhookDelivery(result string) {
	workspaceWebhookDelivery.WithLabelValues(result).Inc()
}

// IncWebhook increments webhook counter.
func IncWebhook(success bool) {
	if success {
		webhookEvents.WithLabelValues("processed").Inc()
	} else {
		webhookEvents.WithLabelValues("failed").Inc()
	}
}

// IncCheckout increments checkout counter.
func IncCheckout(success bool) {
	if success {
		checkoutOps.WithLabelValues("started").Inc()
	} else {
		checkoutOps.WithLabelValues("error").Inc()
	}
}

// IncUsageDrift increments usage drift counter.
func IncUsageDrift() {
	usageDrift.Inc()
}

// IncSubscriptionFallback increments when plan resolution falls back to starter (S1.4).
func IncSubscriptionFallback() {
	subscriptionFallback.Inc()
}

// IncGitHubAppInstallation increments the GitHub App callback counter
// (Plan J-09 T1.1). setupAction MUST be one of "install" or "update";
// the callback handler normalises the empty string to "install" before
// invoking this (matches GitHub's documented default for first-time
// installs). Unknown values are still recorded so dashboards surface
// unexpected GitHub behaviour without losing the event.
func IncGitHubAppInstallation(setupAction string) {
	if setupAction == "" {
		setupAction = "install"
	}
	githubAppInstallations.WithLabelValues(setupAction).Inc()
}

// ObserveHTTPRequest records an HTTP request duration.
func ObserveHTTPRequest(method, path, statusCode string, duration time.Duration) {
	httpRequestDuration.WithLabelValues(method, path, statusCode).Observe(duration.Seconds())
}

// Handler returns an HTTP handler that emits metrics in Prometheus exposition format.
func Handler() http.HandlerFunc {
	h := promhttp.Handler()
	return func(w http.ResponseWriter, r *http.Request) {
		h.ServeHTTP(w, r)
	}
}
