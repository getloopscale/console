// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Cloud Auth Service — handles authentication, OAuth2, and consent flows.
// Sits in front of the Theo engine API, validating JWTs and enforcing plans.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	_ "github.com/jackc/pgx/v5/stdlib"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/trace"

	theojwt "github.com/usetheodev/theo-contracts/jwt"

	"github.com/usetheodev/theo-cloud/internal/auth"
	"github.com/usetheodev/theo-cloud/internal/billing"
	"github.com/usetheodev/theo-cloud/internal/config"
	"github.com/usetheodev/theo-cloud/internal/consent"
	"github.com/usetheodev/theo-cloud/internal/deploy_event_enqueuer"
	"github.com/usetheodev/theo-cloud/internal/lens_alert_evaluator"
	"github.com/usetheodev/theo-cloud/internal/memory_webhook_worker"
	"github.com/usetheodev/theo-cloud/internal/metering"
	cloudmetrics "github.com/usetheodev/theo-cloud/internal/metrics"
	"github.com/usetheodev/theo-cloud/internal/normalize"
	"github.com/usetheodev/theo-cloud/internal/promptly"
	"github.com/usetheodev/theo-cloud/internal/rag"
	"github.com/usetheodev/theo-cloud/internal/ratelimit"
	"github.com/usetheodev/theo-cloud/internal/routes"
	"github.com/usetheodev/theo-cloud/internal/serviceversions"
	"github.com/usetheodev/theo-cloud/internal/skills"
	"github.com/usetheodev/theo-cloud/internal/storage"
	"github.com/usetheodev/theo-cloud/internal/storageproxy"
	"github.com/usetheodev/theo-cloud/internal/thelens"
	"github.com/usetheodev/theo-cloud/internal/themory"
	"github.com/usetheodev/theo-cloud/internal/tracing"
	"github.com/usetheodev/theo-cloud/internal/trust"
	"github.com/usetheodev/theo-cloud/internal/version"
	"github.com/usetheodev/theo-cloud/internal/workspace_webhook_worker"
)

// buildRagForwardAuth constructs the theo-rag Model-B ForwardAuth handler + its broker
// (M14/M16). Returns (nil, nil, nil) when RAG_BASE_URL is unset (feature off),
// (nil, nil, error) when the broker cannot be constructed (caller refuses to start —
// fail-closed at boot), and (handler, broker, nil) when configured. M16 (D2): the broker
// is returned so the SAME broker (one mint cache) serves BOTH the REST ForwardAuth handler
// AND the MCP-resolve rag binding — consistent per-tenant keys across REST + MCP.
func buildRagForwardAuth(
	cfg config.Config,
	resolve routes.APIKeyResolver,
	authorize routes.AccountTenantAuthorizer,
	logger *slog.Logger,
) (*routes.ForwardAuthHandler, routes.TenantKeyMinter, error) {
	if cfg.RagBaseURL == "" {
		return nil, nil, nil
	}
	ragHTTP := &http.Client{Timeout: 10 * time.Second}
	ragAdmin := rag.NewAdminClient(cfg.RagBaseURL, cfg.RagPlatformAdminKey.Value(), ragHTTP)
	ragBroker, err := rag.NewBroker(ragAdmin, 1024, time.Hour,
		[]string{"rag:read", "rag:write", "rag:delete"})
	if err != nil {
		return nil, nil, fmt.Errorf("rag broker: %w", err)
	}
	return routes.NewForwardAuthHandler(resolve, ragBroker, authorize, "rag:read", logger), ragBroker, nil
}

// buildLensForwardAuth constructs the theo-lens Model-B ForwardAuth handler + its broker
// (M38). Returns (nil, nil) when LENS_BASE_URL is unset (feature off), (nil, error) when
// the broker cannot be constructed (caller refuses to start — fail-closed at boot), and
// (handler, nil) when configured. Mirrors buildRagForwardAuth; theo-lens has no MCP/dashboard
// surface in M38 (that is M41+), so only the REST ForwardAuth handler is returned.
func buildLensForwardAuth(
	cfg config.Config,
	resolve routes.APIKeyResolver,
	authorize routes.AccountTenantAuthorizer,
	logger *slog.Logger,
) (*routes.ForwardAuthHandler, routes.TenantKeyMinter, error) {
	if cfg.LensBaseURL == "" {
		return nil, nil, nil
	}
	lensHTTP := &http.Client{Timeout: 10 * time.Second}
	lensAdmin := thelens.NewAdminClient(cfg.LensBaseURL, cfg.LensPlatformAdminKey.Value(), lensHTTP)
	lensBroker, err := thelens.NewBroker(lensAdmin, 1024, time.Hour,
		[]string{"observability:read", "observability:write", "observability:delete"})
	if err != nil {
		return nil, nil, fmt.Errorf("lens broker: %w", err)
	}
	// The SAME broker serves the edge ForwardAuth handler AND the M41 dashboard BFF
	// resolver (one mint cache), mirroring rag. M38 returned only the handler (no
	// dashboard then); M41 exposes the broker for the read BFF.
	return routes.NewForwardAuthHandler(resolve, lensBroker, authorize, "observability:read", logger), lensBroker, nil
}

// ragDashMinter is the least-privilege minting surface the dashboard resolver needs
// (ISP — only KeyForTenantScoped). Satisfied by the rag broker (routes.TenantKeyMinter).
type ragDashMinter interface {
	KeyForTenantScoped(ctx context.Context, accountID, tenantID string, scopes []string) (string, error)
}

// lensDashMinter is the least-privilege minting surface the lens dashboard resolver needs
// (ISP — only KeyForTenantScoped). Satisfied by the lens broker (routes.TenantKeyMinter).
type lensDashMinter interface {
	KeyForTenantScoped(ctx context.Context, accountID, tenantID string, scopes []string) (string, error)
}

// newLensDashboardKeyResolver returns the per-request keyResolver for the M44 lens
// dashboard MANAGEMENT BFF. It reads the tenant from the JWT-derived context ONLY (never a
// request param) and mints a single observability:read+write+delete per-tenant key per request (ADR-1:
// one resolver). Least privilege is at DASHBOARD-SESSION granularity, not per-verb-per-request:
// the minted key carries all three scopes, and theo-lens walls each route by the verb it needs
// (a GET route requires observability:read, a POST observability:write, a DELETE observability:delete — proven at the edge).
// Fail-closed: no authenticated tenant → error, so the data client sends no request.
// Extracted (not inline) so the scope + fail-closed invariants are unit-tested on the SHIPPED path.
func newLensDashboardKeyResolver(minter lensDashMinter) func(ctx context.Context) (string, error) {
	return func(ctx context.Context) (string, error) {
		u := auth.GetUser(ctx)
		if u == nil || u.TenantID == "" {
			return "", fmt.Errorf("lens dashboard: no authenticated tenant in context")
		}
		return minter.KeyForTenantScoped(ctx, u.AccountID, u.TenantID, []string{"observability:read", "observability:write", "observability:delete"})
	}
}

// newRagDashboardKeyResolver returns the per-request keyResolver for the read+write (M21) rag
// dashboard BFF (M17). It reads the tenant from the JWT-derived context ONLY (never a
// request param) and mints a rag:READ-ONLY per-tenant key (least privilege — the
// dashboard can never write/delete). Fail-closed: no authenticated tenant → error, so
// the data client sends no request. Extracted (not inline) so the least-privilege +
// fail-closed invariants are unit-tested on the SHIPPED code path.
func newRagDashboardKeyResolver(minter ragDashMinter) func(ctx context.Context) (string, error) {
	return func(ctx context.Context) (string, error) {
		u := auth.GetUser(ctx)
		if u == nil || u.TenantID == "" {
			return "", fmt.Errorf("rag dashboard: no authenticated tenant in context")
		}
		// M21: the dashboard session mints read+write+delete so a human can manage RAG
		// from the UI (mirrors theo-memory's read+write dashboard broker). theo-rag's
		// per-verb scope still gates every verb; workspace_id == tenant_id is preserved.
		return minter.KeyForTenantScoped(ctx, u.AccountID, u.TenantID, []string{"rag:read", "rag:write", "rag:delete"})
	}
}

// serviceVersionTargets is the data-plane fleet the M21 status panel probes.
//
// Cada alvo lê sua URL da configuração. Uma URL vazia resolve para `not_deployed`
// pela regra genérica — e o serviço continua LISTADO: omiti-lo esconderia que ele
// existe e não subiu, e essa ausência é justamente a notícia que o painel existe
// para dar.
//
// `theo-storage` carregava `""` LITERAL até 2026-07-29, quando de fato não havia
// deploy dele. Passou a haver, e o literal fazia o painel reportar `not deployed`
// sobre um serviço saudável — a mesma classe de mentira que o painel combate, só
// que na direção oposta. Ler da config é o que faz a resposta seguir o ambiente em
// vez de uma constante escrita num dia específico.
func serviceVersionTargets(cfg config.Config) []serviceversions.Target {
	return []serviceversions.Target{
		{Name: "theo-memory", BaseURL: cfg.ThemoryBaseURL},
		{Name: "theo-rag", BaseURL: cfg.RagBaseURL},
		{Name: "theo-lens", BaseURL: cfg.LensBaseURL},
		{Name: "theo-storage", BaseURL: cfg.StorageBaseURL},
		{Name: "theo-skills", BaseURL: cfg.SkillsBaseURL},
		// theo-promptly e theo-trust JA' viviam na config e ficavam FORA desta
		// lista. Era a mesma omissao que o paragrafo acima condena: um servico
		// ausente do painel nao parece ausente — parece inexistente, e quem conta
		// as linhas conclui que a frota esta' completa.
		{Name: "theo-promptly", BaseURL: cfg.PromptlyBaseURL},
		{Name: "theo-trust", BaseURL: cfg.TrustBaseURL},
		// O engine. So' pode ser sondado desde que passou a falar o contrato da
		// frota (`GET /v1/version` -> {version, built_at}): antes servia
		// `/api/v1/version` com `build_date`, divergindo em path E em campo, e o
		// coletor nao tem como negociar formato por alvo.
		//
		// Reusa EngineAPIURL, a MESMA URL pela qual este gateway ja' faz proxy do
		// engine. Uma variavel propria poderia divergir dela e o painel passaria a
		// reportar sobre um endereco que ninguem mais usa.
		{Name: "theo-api", BaseURL: cfg.EngineAPIURL},
		// O gateway MCP. A URL aponta para a RAIZ do processo, nao para a borda
		// `/mcp` do Traefik: aquele roteador NAO remove o prefixo (deliberado — o
		// gateway precisa do path completo para rotear MCP), entao uma sonda via
		// `/mcp` chegaria como `/mcp/v1/version`, cairia no catch-all do proxy e
		// devolveria 404 sobre um servico saudavel. Medido: 404 pela borda, 200
		// pela raiz.
		{Name: "theo-traefik-mcp", BaseURL: cfg.TraefikMcpBaseURL},
	}
}

// mountServiceVersions assembles and registers the M21 status aggregate.
//
// It is a named function rather than inline wiring so the composition can be
// exercised (cmd/service_versions_wiring_test.go): the route set, the JWT gate and
// the probed fleet were all unasserted while this lived inside main().
//
// D5 — a dedicated client, never safehttp: safehttp.IsDisallowedIP rejects
// loopback, RFC1918 and the 100.64.0.0/10 CGNAT range, which is exactly where
// these targets live, so every probe would fail and the UI would read the security
// guard as "the service is down". otelhttp keeps the most diagnostic call in the
// system visible in theo-lens.
func mountServiceVersions(r chi.Router, cfg config.Config, logger *slog.Logger, requireJWT func(http.Handler) http.Handler) {
	versionHTTP := &http.Client{
		Timeout:   10 * time.Second, // last-resort ceiling, never the policy (D1)
		Transport: otelhttp.NewTransport(http.DefaultTransport),
	}
	targets := serviceVersionTargets(cfg)

	// theo-workspace#37 — UMA observacao alimenta AS DUAS metricas.
	//
	// Deliberadamente um adaptador sobre o hook existente, e nao um segundo caminho de
	// coleta: dois caminhos divergem, e divergencia entre duas leituras do mesmo fato ja
	// custou tres diagnosticos errados num unico dia (dois theo-cloud, dois paineis).
	//
	// O counter responde "quantas sondagens aconteceram"; o gauge responde "qual e' o
	// estado AGORA". Sao perguntas diferentes e nenhuma das duas responde a outra.
	observe := func(service, result, version string) {
		cloudmetrics.IncServiceVersionProbe(service, result)
		cloudmetrics.SetServiceVersionInfo(service, result, version)
	}

	// Semeia TODO alvo declarado antes da primeira coleta. Sem isto, um scrape tomado
	// entre o start do processo e a primeira coleta nao lista alvo algum, e a ausencia de
	// serie significaria duas coisas — "nao declarado" e "ainda nao coletado". Essa
	// ambiguidade e' exatamente o que tornava o counter inutil para responder "qual e' o
	// estado da frota agora".
	for _, t := range targets {
		cloudmetrics.SeedServiceVersionInfo(t.Name)
	}
	cloudmetrics.SeedServiceVersionInfo(version.Read().Name)

	collector := serviceversions.NewCollector(serviceversions.Options{
		Client:     versionHTTP,
		Targets:    targets,
		PerService: 2 * time.Second,
		Global:     3 * time.Second,
		OnResult:   observe,
		Logger:     logger,
	})
	// M22 — o proprio gateway entra no painel que ele serve.
	//
	// A decoracao acontece AQUI, no composition root, e nao dentro de internal/serviceversions: a
	// interface VersionCollector e declarada do lado do CONSUMIDOR e satisfeita implicitamente, o
	// que faz dela o seam certo — a quinta linha custa zero mudanca ao pacote do M21, cuja union
	// type continua com quatro construtores e campos nao exportados.
	//
	// A linha vem de metadados de build IN-PROCESS, nunca de uma chamada HTTP a nos mesmos: um
	// servico que se sonda reporta a propria vivacidade, que e o unico fato que um painel de status
	// nao consegue aprender assim.
	//
	// O OnResult do coletor dispara uma vez por TARGET dentro de Collect, entao a linha apendada
	// depois seria invisivel para ele e o censo do Prometheus discordaria do censo do JSON por um.
	// Por isso o decorator emite a propria observacao.
	selfAware := routes.NewSelfReportingCollector(
		collector, version.Read(), time.Now, observe,
	)
	routes.MountServiceVersions(r, routes.NewServiceVersionsHandler(selfAware, logger), requireJWT)
}

// mountRagDashboard registers the /v1/dashboard/rag BFF route group. M17 shipped it
// read-only; M21 lifts it to read+write (create/delete collections + documents, ask) so
// the dashboard UI can manage RAG. The route-set invariant test (main_test.go) asserts
// the expected read+write set; the SDK/edge surface /v1/rag/* stays a distinct mount.
func mountRagDashboard(r chi.Router, h *routes.RagDashboardHandler, oauth *routes.RagConnectorsOAuthHandler, requireJWT func(http.Handler) http.Handler) {
	r.Route("/v1/dashboard/rag", func(r chi.Router) {
		r.Use(requireJWT)
		// reads (M17)
		r.Get("/collections", h.ListCollections)
		r.Get("/analytics", h.Analytics)
		r.Get("/documents", h.ListDocuments)
		// M10 — GraphRAG explorer reads (persisted graph + communities), per-collection.
		r.Get("/collections/{id}/graph", h.GraphView)
		r.Get("/collections/{id}/communities", h.Communities)
		// M13 — full community report (title + full_content + findings) drill-down.
		r.Get("/collections/{id}/communities/{key}/report", h.CommunityReport)
		// chunk-editor — view a document's chunks + read one chunk (rag:read).
		r.Get("/documents/{id}/chunks", h.ListDocumentChunks)
		r.Get("/chunks/{id}", h.GetChunk)
		// Open Wiki — list wiki pages + read one page (rag:read).
		r.Get("/wiki/pages", h.ListWikiPages)
		r.Get("/wiki/pages/{id}", h.GetWikiPage)
		// M26 — OKF directory: deterministic index.md + agent log.md (rag:read).
		r.Get("/wiki/index", h.WikiIndex)
		r.Get("/wiki/log", h.WikiLog)
		// writes (M21)
		r.Post("/collections", h.CreateCollection)
		r.Delete("/collections/{id}", h.DeleteCollection)
		r.Post("/documents", h.IngestDocument)
		// M11 — file upload (PDF/office/CSV/image), streamed to theo-rag's async ingest.
		r.Post("/documents/file", h.UploadDocumentFile)
		r.Delete("/documents/{id}", h.DeleteDocument)
		r.Post("/answers", h.Ask)
		// chunk-editor — edit a chunk's text (rag:write); theo-rag re-embeds it server-side.
		r.Patch("/chunks/{id}", h.UpdateChunk)
		// Open Wiki — create a markdown wiki page (rag:write).
		r.Post("/wiki/pages", h.CreateWikiPage)
		// KB0 — wiki page lifecycle: update (rag:write, OKF-aware re-embed + rename/move) + delete (rag:delete).
		r.Put("/wiki/pages/{id}", h.UpdateWikiPage)
		r.Delete("/wiki/pages/{id}", h.DeleteWikiPage)
		// connectors (#191 + M8 connect)
		r.Get("/connectors", h.ListConnectors)
		r.Post("/connectors/{provider}/connect", h.ConnectConnector)
		r.Post("/connectors/{id}/sync", h.SyncConnector)
		r.Delete("/connectors/{id}", h.DeleteConnector)
		// M8 OAuth: the providers list is a Bearer API (the dashboard fetches it). The authorize +
		// callback browser-redirect halves are mounted separately at the root path /v1/rag-connect
		// (cookie-session auth, #199) — they must NOT be under this Bearer-only requireJWT group.
		r.Get("/connectors/providers", oauth.ListOAuthProviders)
	})
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	// Initialize OTel tracing (no-op if THEO_TRACING_ENABLED=false).
	tracingShutdown, err := tracing.Init(context.Background(), "theo-cloud")
	if err != nil {
		logger.Warn("tracing init failed (continuing without traces)", "error", err)
	}

	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	// Initialize database connection (optional in dev, required in prod).
	// The cloud service shares the database with the engine API.
	// It does NOT run migrations — the API owns all schema changes.
	var db *sql.DB
	if cfg.DatabaseURL != "" {
		var err error
		db, err = sql.Open("pgx", cfg.DatabaseURL)
		if err != nil {
			logger.Error("failed to open database", "error", err)
			os.Exit(1)
		}
		db.SetMaxOpenConns(10)
		db.SetMaxIdleConns(5)
		db.SetConnMaxLifetime(5 * time.Minute)

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := db.PingContext(ctx); err != nil {
			logger.Warn("database not reachable at startup (will retry on requests)", "error", err)
		} else {
			logger.Info("database connected")
		}
	} else {
		logger.Warn("DATABASE_URL not set — billing, enforcement, and metering disabled")
	}

	// Initialize Hydra client
	hydra := auth.NewHydraClient(cfg.HydraPublicURL, cfg.HydraAdminURL, cfg.HydraClientID)

	// Register CLI OAuth2 client in Hydra (idempotent — safe on every startup).
	// Include both localhost (dev) and production dashboard callback URLs.
	// Register redirect URIs for PKCE callback.
	// Include localhost (dev) and dashboard URL (which may be served at a different domain).
	// The dashboard uses window.location.origin for redirect_uri, so we register both
	// the dashboard subdomain and the API gateway domain where it may also be served.
	redirectURIs := []string{
		"http://localhost:9876/auth",
		cfg.BillingReturnURL + "/login/callback",
	}
	// If Kratos public URL differs from BillingReturnURL, the dashboard may be
	// served at the Kratos domain (Option D: API gateway). Register that too.
	if cfg.KratosPublicURL != "" && cfg.KratosPublicURL != cfg.BillingReturnURL {
		redirectURIs = append(redirectURIs, cfg.KratosPublicURL+"/login/callback")
	}
	if err := hydra.RegisterClient(redirectURIs); err != nil {
		logger.Warn("failed to register OAuth2 client (Hydra may not be ready yet)", "error", err)
	}

	// JWT validation — single source of truth (pkg/jwt).
	//
	// CANONICAL FIX 2026-06-15 (multi-audience JWT per RFC 7519 § 4.1.3):
	// theo-cloud MUST accept BOTH:
	//   - "theo-cloud" — its own dashboard session JWTs (HMAC-signed via
	//     SessionTokenIssuer below; sourced from /v1/auth/session/token
	//     cookie-based exchange)
	//   - "theo-engine" — bootstrap + CLI JWTs (RSA-signed by Hydra; minted
	//     by seed-local-user.sh + theo CLI) which transit /engine/* paths
	//     into theo-api (which itself validates "theo-engine")
	//
	// Single-audience validation (aud="theo-cloud" only) caused 11/12
	// dogfood --live-only wrappers to fail because the bootstrap JWT
	// audience is "theo-engine" by design. Multi-audience constructor
	// matches the AWS Cognito + Auth0 + Okta + Google Cloud Identity
	// canonical pattern. Zero technical debt — single-aud NewValidator
	// is preserved for backward compat (delegates to multi-aud with
	// []string{audience}).
	jwksURL := cfg.HydraPublicURL + "/.well-known/jwks.json"
	jwtValidator := theojwt.NewValidatorWithAudiences(
		jwksURL,
		cfg.JWTIssuer,
		[]string{"theo-cloud", "theo-engine"},
	)

	// Session token issuer/validator (HMAC JWTs for dashboard)
	// MEET-2026-04-07-039: audience explicit. §2.2: kid + dual-key rotation.
	sessIssuer := theojwt.NewSessionTokenIssuer(
		cfg.SessionTokenSecret.Value(),
		"theo-cloud",
		"theo-cloud",
		24*time.Hour,
	).WithPreviousSecret(string(cfg.SessionTokenSecretPrevious))
	tenantProvisioner := auth.NewTenantProvisioner(db, logger)
	sessionTokenHandler := routes.NewSessionTokenHandler(sessIssuer, tenantProvisioner, cfg.KratosInternalURL)

	// Billing (optional — requires Stripe keys and DB)
	var stripeClient *billing.StripeClient
	var webhookHandler *billing.WebhookHandler
	var billingHandler *routes.BillingHandler
	var billingProvisioner *billing.Provisioner

	if cfg.StripeAPIKey.Value() != "" {
		stripeClient = billing.NewStripeClient(cfg.StripeAPIKey.Value())
		webhookHandler = billing.NewWebhookHandler(db, cfg.StripeWebhookSecret.Value(), billing.LoadPlanConfig(), logger)
		billingProvisioner = billing.NewProvisioner(db, stripeClient, logger)
		billingHandler = routes.NewBillingHandler(db, stripeClient, webhookHandler, billingProvisioner, cfg.BillingReturnURL)
		logger.Info("billing enabled")
	} else {
		logger.Warn("STRIPE_API_KEY not set — billing endpoints disabled")
	}

	// Universal JWT auth middleware (RSA + HMAC — one path for all)
	requireJWT := auth.RequireJWT(jwtValidator, sessIssuer)

	// Rate limiters (find_sec_007). Device endpoints are pre-auth → keyed on
	// client IP (chimw.RealIP already resolves the real client behind the proxy).
	// Device token is polled (~12/min legitimately) so its limit is generous.
	// Billing mutations are per authenticated user.
	deviceLimiter := ratelimit.NewInMemoryLimiter(60, time.Minute)
	billingLimiter := ratelimit.NewInMemoryLimiter(30, time.Minute)
	// F-sec-1 absorption: BFF-layer defense-in-depth for /v1/auth/register.
	// Caddy edge `register_throttle` (5/min) matches /self-service/registration/*
	// on auth-dev.usetheo.dev only — the BFF endpoint on cloud-dev / app-dev
	// is reachable without that edge gate (k8s NodePort, cross-cluster, dev
	// direct hits). 5/min/IP keeps brute-force registration infeasible even
	// when Caddy is bypassed. Per Red Team theo-cloud#43 closure plan.
	registerLimiter := ratelimit.NewInMemoryLimiter(5, time.Minute)
	ipKey := func(r *http.Request) string { return ratelimit.Key("", r.RemoteAddr) }
	userKey := func(r *http.Request) string {
		if u := auth.GetUser(r.Context()); u != nil {
			return ratelimit.Key(u.Subject, r.RemoteAddr)
		}
		return ratelimit.Key("", r.RemoteAddr)
	}

	// Handlers
	deviceHandler := routes.NewDeviceHandler(hydra, cfg.BillingReturnURL)
	// meHandler carries the tenant provisioning snapshot (M0 J-02 T1.2) and
	// lazily ensures the free starter plan (T1.3). Pass the provisioner only when
	// billing is enabled — a typed-nil *billing.Provisioner in the interface param
	// would be non-nil and panic on the lazy-provision call.
	var meHandler *routes.MeHandler
	if billingProvisioner != nil {
		meHandler = routes.NewMeHandler(db, billingProvisioner)
	} else {
		meHandler = routes.NewMeHandler(db, nil)
	}
	// T3.1 of plan kratos-self-service-rate-limit-systemic v1.1 — response-shape
	// unifier middleware closing Red Team theo-cloud#43 (account enumeration via
	// register response shape divergence). Proxies POST /v1/auth/register to the
	// upstream identity-store and ALWAYS returns the canonical universal body
	// regardless of new-vs-existing-email branch.
	registerProxyHandler := routes.NewRegisterProxyHandler(cfg.KratosInternalURL, logger)
	consentHandler := consent.NewHandler(hydra, tenantProvisioner, cfg.KratosPublicURL, cfg.KratosInternalURL, cfg.KratosAdminURL, logger)

	// Plan 0 of dashboard-memory-section-roadmap.md: unified theo_live_* API keys.
	// D8 dispatch: /v1/api-keys/* uses RequireJWT (PaaS session cookie), NOT
	// RequireScope. The scope-checked Bearer surface is the consumer side
	// (memory + future verticals), registered in subsequent plans.
	apiKeysHandler := routes.NewAPIKeysHandler(db, logger)

	// Plan 1 of dashboard-memory-section-roadmap.md: Memory Shell — Go proxy to
	// OSS TheMemory. Only instantiated when THEMORY_BASE_URL is configured,
	// matching the same opt-in pattern as billing (BillingHandler is nil when
	// Stripe is not configured). Operators must set THEMORY_BASE_URL +
	// THEMORY_API_KEY before /v1/memory/* routes are usable.
	var memoryHandler *routes.MemoryHandler
	var memoryWebhooksHandler *routes.MemoryWebhooksHandler
	var memoryExportsHandler *routes.MemoryExportsHandler
	// M11 (theo-promptly Model B L2): a 2nd ForwardAuth handler for the
	// /v1/promptly capability. Reuses the generic handler (ADR D5) wired with the
	// promptly broker + "promptly:read"; only registered when PROMPTLY_BASE_URL is
	// set. The broker translates promptly:* -> prompt:* and mints per-tenant.
	var promptlyForwardAuthHandler *routes.ForwardAuthHandler
	// M25 — o BFF do catálogo de prompts do dashboard. Nil quando PROMPTLY_BASE_URL está ausente:
	// sem broker não há cunhagem por inquilino, e sem ela a rota não deve existir.
	var promptlyDashboardHandler *routes.PromptlyDashboardHandler
	// theo-promptly#50: o broker sai do escopo do bloco `if` abaixo para poder servir
	// TAMBEM o binding MCP montado adiante — exatamente como `ragBroker` ja faz. Um
	// unico broker para as duas superficies significa UM cache de mint, logo chaves
	// per-tenant consistentes entre o ForwardAuth do REST e o resolve do gateway; dois
	// brokers cunhariam credenciais diferentes para o mesmo inquilino.
	//
	// As duas declaracoes convivem porque resolvem coisas diferentes e ADITIVAS: esta hasteia o
	// broker para o MCP, aquela guarda o handler do dashboard. O conflito foi de posicao no
	// arquivo, nao de intencao — descartar qualquer uma das duas removeria uma capacidade.
	var promptlyBroker *promptly.Broker
	// #334: integracao desligada por falta de configuracao deixa de ser silenciosa.
	// Sem este aviso, a capacidade some da borda e o sintoma aparece tres camadas
	// adiante (o ForwardAuth recebe 404 e o edge o repassa), sem nada no boot que
	// ligue uma coisa a outra. Nomes, nunca valores: varios destes sao credenciais.
	if missing := config.MissingSettings(
		config.Setting{Name: "PROMPTLY_BASE_URL", Value: cfg.PromptlyBaseURL},
	); len(missing) > 0 {
		logger.Warn("integration disabled — configuration absent",
			"integration", "promptly", "missing", missing)
	}
	if cfg.PromptlyBaseURL != "" {
		promptlyHTTP := &http.Client{Timeout: 10 * time.Second}
		promptlyAdmin := promptly.NewAdminClient(cfg.PromptlyBaseURL, cfg.PromptlyPlatformAdminKey.Value(), promptlyHTTP)
		var pErr error
		promptlyBroker, pErr = promptly.NewBroker(promptlyAdmin, 1024, time.Hour,
			[]string{"prompt:read", "prompt:write"})
		if pErr != nil {
			logger.Error("failed to construct promptly credential broker — refusing to start", "error", pErr)
			os.Exit(1)
		}
		promptlyForwardAuthHandler = routes.NewForwardAuthHandler(
			func(ctx context.Context, rawAuthHeader string) (*auth.UserContext, []string, error) {
				return auth.ResolveAPIKey(ctx, db, rawAuthHeader)
			},
			promptlyBroker,
			// M1: cross-account guard (same DB-backed ownership check).
			func(ctx context.Context, accountID, tenantID string) (bool, error) {
				return auth.AccountOwnsTenant(ctx, db, accountID, tenantID)
			},
			"promptly:read",
			logger,
		)
		// M25 — o BFF do catálogo de prompts. DOIS clientes, com credenciais distintas: o de
		// leitura recebe uma chave que não consegue promover, e a promoção é o único caminho com
		// `prompt:write`. A separação é o menor privilégio; ver `promptly_dashboard_wiring.go`.
		// M14 — a invocacao do playground tem orcamento PROPRIO. Os 10 s do cliente compartilhado
		// servem uma leitura e nao servem uma geracao de LLM: com eles, o BFF desistia antes de a
		// recusa tipada existir e o operador via "nao foi possivel falar com o servico" para uma
		// chave invalida — com a quota dele ja gasta. 120 s cabe sob o WriteTimeout do servidor.
		promptlyInvocationHTTP := &http.Client{Timeout: 120 * time.Second}
		promptlyDataClient := promptly.NewDataClient(cfg.PromptlyBaseURL, promptlyHTTP).
			WithInvocationClient(promptlyInvocationHTTP).
			WithKeyResolver(newPromptlyDashboardKeyResolver(promptlyBroker))
		promptlyWriteClient := promptly.NewWriteClient(cfg.PromptlyBaseURL, promptlyHTTP).
			WithKeyResolver(newPromptlyPromotionKeyResolver(promptlyBroker))
		promptlyDashboardHandler = routes.NewPromptlyDashboardHandler(promptlyDataClient, promptlyWriteClient, logger)
		logger.Info("theo-promptly Model B broker wired (L2)", "base_url", cfg.PromptlyBaseURL)
	}

	// M10 (theo-trust Model B L2): a ForwardAuth handler for the /v1/trust
	// capability. Reuses the generic handler wired with the trust broker +
	// "trust:read"; only registered when TRUST_BASE_URL is set. The broker mints a
	// per-tenant trust_live_* key (least-privilege intersection of the consumer's
	// trust:* scopes with the data scopes) and fails CLOSED — no master fallback.
	var trustForwardAuthHandler *routes.ForwardAuthHandler
	var trustDashboardHandler *routes.TrustDashboardHandler
	var trustGuardrailsHandler *routes.TrustGuardrailsHandler
	// #334: integracao desligada por falta de configuracao deixa de ser silenciosa.
	// Sem este aviso, a capacidade some da borda e o sintoma aparece tres camadas
	// adiante (o ForwardAuth recebe 404 e o edge o repassa), sem nada no boot que
	// ligue uma coisa a outra. Nomes, nunca valores: varios destes sao credenciais.
	if missing := config.MissingSettings(
		config.Setting{Name: "TRUST_BASE_URL", Value: cfg.TrustBaseURL},
	); len(missing) > 0 {
		logger.Warn("integration disabled — configuration absent",
			"integration", "trust", "missing", missing)
	}
	if cfg.TrustBaseURL != "" {
		trustHTTP := &http.Client{Timeout: 10 * time.Second}
		trustAdmin := trust.NewAdminClient(cfg.TrustBaseURL, cfg.TrustPlatformAdminKey.Value(), trustHTTP)
		// LT-052 — a lista vem de `trust.CustomerScopes`, fonte ÚNICA compartilhada com o
		// enum de emissão. Era um literal aqui, e a divergência entre os dois lugares já
		// produziu quatro falhas silenciosas: escopo no broker e fora do enum deixa a
		// capacidade inalcançável; escopo no enum e fora do broker faz a borda DESCARTÁ-LO
		// na travessia, com a API respondendo 200 e cunhando a chave assim mesmo.
		trustBroker, tErr := trust.NewBroker(trustAdmin, 1024, time.Hour, trust.CustomerScopes)
		if tErr != nil {
			logger.Error("failed to construct trust credential broker — refusing to start", "error", tErr)
			os.Exit(1)
		}
		trustForwardAuthHandler = routes.NewForwardAuthHandler(
			func(ctx context.Context, rawAuthHeader string) (*auth.UserContext, []string, error) {
				return auth.ResolveAPIKey(ctx, db, rawAuthHeader)
			},
			trustBroker,
			// cross-account guard — does the resolved account own this tenant?
			func(ctx context.Context, accountID, tenantID string) (bool, error) {
				return auth.AccountOwnsTenant(ctx, db, accountID, tenantID)
			},
			"trust:read",
			logger,
		)
		logger.Info("theo-trust Model B broker wired (L2)", "base_url", cfg.TrustBaseURL)

		// M23 — o BFF de LEITURA do dashboard reusa o MESMO broker, mas com um resolver proprio
		// que cunha somente `trust:read`. O ForwardAuth acima carrega os tres escopos porque
		// intermedia o consumidor (que pode legitimamente escrever); o dashboard, no caminho de
		// leitura, nao pode — e a chave que ele recebe nao deve poder.
		trustDataClient := trust.NewDataClient(cfg.TrustBaseURL, &http.Client{Timeout: 15 * time.Second}).
			WithKeyResolver(newTrustDashboardKeyResolver(trustBroker))
		trustDashboardHandler = routes.NewTrustDashboardHandler(trustDataClient, logger)
		logger.Info("dashboard trust enabled (per-tenant read-only broker)", "mount", "/v1/dashboard/trust")

		// M24 — o caminho de MUTACAO recebe um cliente PROPRIO, com resolver proprio. Dois clientes
		// e nao um porque a credencial e a fronteira: o de leitura carrega so `trust:read` e nao
		// consegue escrever nem por engano.
		trustWriteClient := trust.NewDataClient(cfg.TrustBaseURL, &http.Client{Timeout: 20 * time.Second}).
			WithKeyResolver(newTrustGuardrailsKeyResolver(trustBroker))
		trustGuardrailsHandler = routes.NewTrustGuardrailsHandler(trustWriteClient, logger)
		logger.Info("dashboard trust guardrails enabled (per-tenant write broker)", "mount", "/v1/dashboard/trust/guardrails")
	}

	// M22 (theo-skills Model B): a ForwardAuth handler for the /v1/skills
	// capability. Reuses the generic handler wired with the skills broker +
	// "skills:read"; only registered when SKILLS_BASE_URL is set. The broker mints a
	// per-tenant theoskill_live_* key (least-privilege intersection of the consumer's
	// skills:* scopes with the data scopes) and fails CLOSED — no master fallback.
	//
	// The mint targets theo-skills' PLATFORM route, not its admin one: the admin
	// route derives the workspace from the caller's principal and requires the
	// target to be a member of it, so a broker cannot use it to reach an arbitrary
	// tenant.
	var skillsForwardAuthHandler *routes.ForwardAuthHandler
	// M26 — o BFF de leitura do registro para o dashboard, cliente SEPARADO do ForwardAuth e com
	// credencial cunhada apenas com `skills:read` (ver `skills_dashboard_wiring.go`).
	var skillsDashboardHandler *routes.SkillsDashboardHandler
	// M26 T3.5 — o caminho de MUTACAO, com cliente e credencial PROPRIOS (`skills:publish`).
	var skillsPromotionHandler *routes.SkillsPromotionHandler
	// #334: integracao desligada por falta de configuracao deixa de ser silenciosa.
	// Sem este aviso, a capacidade some da borda e o sintoma aparece tres camadas
	// adiante (o ForwardAuth recebe 404 e o edge o repassa), sem nada no boot que
	// ligue uma coisa a outra. Nomes, nunca valores: varios destes sao credenciais.
	if missing := config.MissingSettings(
		config.Setting{Name: "SKILLS_BASE_URL", Value: cfg.SkillsBaseURL},
		config.Setting{Name: "SKILLS_PLATFORM_ADMIN_KEY", Value: cfg.SkillsPlatformAdminKey.Value()},
	); len(missing) > 0 {
		logger.Warn("integration disabled — configuration absent",
			"integration", "skills", "missing", missing)
	}
	if cfg.SkillsBaseURL != "" && cfg.SkillsPlatformAdminKey.Value() != "" {
		skillsHTTP := &http.Client{Timeout: 10 * time.Second}
		skillsAdmin := skills.NewAdminClient(cfg.SkillsBaseURL, cfg.SkillsPlatformAdminKey.Value(), skillsHTTP)
		// `skills:admin` is deliberately ABSENT from the mintable set: it is the
		// key-lifecycle scope, and a gateway-minted credential must never be able to
		// provision further credentials. Same posture as rag:admin.
		skillsBroker, sErr := skills.NewBroker(skillsAdmin, 1024, time.Hour,
			[]string{"skills:read", "skills:write", "skills:publish"})
		if sErr != nil {
			logger.Error("failed to construct skills credential broker — refusing to start", "error", sErr)
			os.Exit(1)
		}
		skillsForwardAuthHandler = routes.NewForwardAuthHandler(
			func(ctx context.Context, rawAuthHeader string) (*auth.UserContext, []string, error) {
				return auth.ResolveAPIKey(ctx, db, rawAuthHeader)
			},
			skillsBroker,
			// cross-account guard — does the resolved account own this tenant?
			func(ctx context.Context, accountID, tenantID string) (bool, error) {
				return auth.AccountOwnsTenant(ctx, db, accountID, tenantID)
			},
			"skills:read",
			logger,
		)
		logger.Info("theo-skills Model B broker wired", "base_url", cfg.SkillsBaseURL)

		// M26 — o caminho de LEITURA do dashboard. Cliente próprio, com um resolver que cunha
		// somente `skills:read`: a separação entre este cliente e o do ForwardAuth É o mecanismo
		// de menor privilégio, não organização de arquivo. `skills:publish` — o escopo que
		// promove um canal e redireciona seus consumidores sem redeploy — nunca entra aqui.
		skillsDataClient := skills.NewDataClient(cfg.SkillsBaseURL, &http.Client{Timeout: 15 * time.Second}).
			WithKeyResolver(newSkillsDashboardKeyResolver(skillsBroker))
		skillsDashboardHandler = routes.NewSkillsDashboardHandler(skillsDataClient, logger)
		logger.Info("dashboard skills enabled (per-tenant read-only broker)", "mount", "/v1/dashboard/skills")

		// M26 T3.5 — promocao de canal. Cliente SEPARADO do de leitura, e a separacao e o
		// mecanismo de menor privilegio: o de leitura carrega so `skills:read` e nao consegue
		// promover nem que uma rota mutante seja registrada sobre ele por engano.
		skillsWriteClient := skills.NewDataClient(cfg.SkillsBaseURL, &http.Client{Timeout: 20 * time.Second}).
			WithKeyResolver(newSkillsPromotionKeyResolver(skillsBroker))
		skillsPromotionHandler = routes.NewSkillsPromotionHandler(skillsWriteClient, logger)
		logger.Info("dashboard skills promotion enabled (per-tenant publish broker)", "mount", "/v1/dashboard/skills/{id}/channels/{channel}")
	}

	// M14 (edge-integration): a 3rd ForwardAuth handler for the theo-rag
	// capability. Built via buildRagForwardAuth (testable) — nil when RAG_BASE_URL
	// is unset (feature off), error → refuse to start (boot-failure).
	ragForwardAuthHandler, ragBroker, ragErr := buildRagForwardAuth(
		cfg,
		func(ctx context.Context, rawAuthHeader string) (*auth.UserContext, []string, error) {
			return auth.ResolveAPIKey(ctx, db, rawAuthHeader)
		},
		// cross-account guard (same DB-backed ownership check).
		func(ctx context.Context, accountID, tenantID string) (bool, error) {
			return auth.AccountOwnsTenant(ctx, db, accountID, tenantID)
		},
		logger,
	)
	if ragErr != nil {
		logger.Error("failed to construct rag credential broker — refusing to start", "error", ragErr)
		os.Exit(1)
	}
	if ragForwardAuthHandler != nil {
		logger.Info("theo-rag Model B broker wired (M14)", "base_url", cfg.RagBaseURL)
	}

	// M38 (edge-integration): a 4th ForwardAuth handler for the theo-lens
	// capability. Built via buildLensForwardAuth (testable) — nil when LENS_BASE_URL
	// is unset (feature off), error → refuse to start (boot-failure).
	lensForwardAuthHandler, lensBroker, lensErr := buildLensForwardAuth(
		cfg,
		func(ctx context.Context, rawAuthHeader string) (*auth.UserContext, []string, error) {
			return auth.ResolveAPIKey(ctx, db, rawAuthHeader)
		},
		// cross-account guard (same DB-backed ownership check).
		func(ctx context.Context, accountID, tenantID string) (bool, error) {
			return auth.AccountOwnsTenant(ctx, db, accountID, tenantID)
		},
		logger,
	)
	if lensErr != nil {
		logger.Error("failed to construct lens credential broker — refusing to start", "error", lensErr)
		os.Exit(1)
	}
	if lensForwardAuthHandler != nil {
		logger.Info("theo-lens Model B broker wired (M38)", "base_url", cfg.LensBaseURL)
	}

	// M41: the read-only /v1/dashboard/lens BFF. Wired only when the lens broker is
	// configured. The dashboard keyResolver mints a lens:READ-ONLY per-tenant key from
	// the JWT-derived tenant (least privilege — the dashboard can never write/delete; the
	// write half is M44), mirroring the rag M17 read BFF.
	var lensDashboardHandler *routes.LensDashboardHandler
	if lensBroker != nil {
		// 35s (not the usual 10s): this client also proxies the LLM-backed M33 Ask + M55
		// replay paths, whose downstream chat client caps at 30s (theo-lens CHAT_TIMEOUT_MS).
		// A 10s ceiling raced the LLM call → 502 "context deadline exceeded" on legitimate
		// asks. Mirrors the themory LLM path (30s). Fast paths (traces list/cost) are
		// unaffected — the timeout is only a ceiling.
		lensDataClient := thelens.NewDataClient(cfg.LensBaseURL, &http.Client{Timeout: 35 * time.Second}).
			WithKeyResolver(newLensDashboardKeyResolver(lensBroker))
		lensDashboardHandler = routes.NewLensDashboardHandler(lensDataClient, logger)
		logger.Info("dashboard lens enabled (per-tenant read-only broker)", "mount", "/v1/dashboard/lens")
	}

	// M17: the read+write /v1/dashboard/rag BFF (M21). Wired only when the rag broker is
	// configured. The dashboard keyResolver mints a rag:READ-ONLY per-tenant key from
	// the JWT-derived tenant (least privilege — the dashboard can never write/delete),
	// mirroring the memory dashboard BFF but stricter (memory mints full scopes).
	var ragDashboardHandler *routes.RagDashboardHandler
	var ragConnectorsOAuth *routes.RagConnectorsOAuthHandler
	if ragBroker != nil {
		ragDataClient := rag.NewDataClient(cfg.RagBaseURL, &http.Client{Timeout: 10 * time.Second}).
			WithKeyResolver(newRagDashboardKeyResolver(ragBroker))
		ragDashboardHandler = routes.NewRagDashboardHandler(ragDataClient, logger)
		// M8 — the OAuth authorization broker. Provider apps are gated on env (LoadOAuthConnectorsFromEnv):
		// a provider is offered only once its OAuth app (client_id/secret) is registered by the operator.
		// authorize/callback are BROWSER redirects (#199) — authenticated by the Kratos session cookie
		// (resolveTenant), NOT a Bearer JWT — and mounted at the root path /v1/rag-connect (below), so
		// the redirect_uri lives on THIS (BFF) origin where the CSRF/PKCE cookies are set.
		oauthProviders, oauthSecrets := routes.LoadOAuthConnectorsFromEnv(os.Getenv)
		redirectBase := os.Getenv("RAG_OAUTH_REDIRECT_BASE")
		if redirectBase == "" {
			redirectBase = cfg.CloudPublicURL + "/v1/rag-connect"
		}
		ragLoginURL := cfg.AppPublicURL + "/login"
		if cfg.KratosPublicURL != "" {
			ragLoginURL = cfg.KratosPublicURL + "/login"
		}
		ragOAuthResolver := routes.NewKratosSessionTenantResolver(cfg.KratosInternalURL, tenantProvisioner)
		ragConnectorsOAuth = routes.NewRagConnectorsOAuthHandler(
			oauthProviders, ragDataClient,
			routes.NewHTTPTokenExchanger(oauthProviders, oauthSecrets, &http.Client{Timeout: 15 * time.Second}),
			ragOAuthResolver.Resolve,
			redirectBase, cfg.AppPublicURL, ragLoginURL, cfg.AuthCookieDomain, logger)
		logger.Info("dashboard rag enabled (per-tenant read+write broker)", "mount", "/v1/dashboard/rag", "oauth_providers", len(oauthProviders))
	}

	// platform-api-gateway-edge-slice1 (M6): the ForwardAuth authz-brain the
	// Traefik edge delegates to. Reuses the broker (per-tenant mint) + ResolveAPIKey.
	var forwardAuthHandler *routes.ForwardAuthHandler
	var mcpResolveHandler *routes.MCPResolveHandler
	// M16 (D2): the MCP-resolve capability bindings, populated by whichever brokers are
	// configured (memory in the block below; rag after it). The resolve handler is built
	// once, after both, so it exists whenever ANY capability is configured — the rag MCP
	// binding is no longer coupled to memory being enabled.
	mcpCaps := map[string]routes.MCPCapabilityBinding{}
	// #334: integracao desligada por falta de configuracao deixa de ser silenciosa.
	// Sem este aviso, a capacidade some da borda e o sintoma aparece tres camadas
	// adiante (o ForwardAuth recebe 404 e o edge o repassa), sem nada no boot que
	// ligue uma coisa a outra. Nomes, nunca valores: varios destes sao credenciais.
	if missing := config.MissingSettings(
		config.Setting{Name: "THEMORY_BASE_URL", Value: cfg.ThemoryBaseURL},
	); len(missing) > 0 {
		logger.Warn("integration disabled — configuration absent",
			"integration", "memory", "missing", missing)
	}
	if cfg.ThemoryBaseURL != "" {
		themoryHTTP := &http.Client{
			Timeout:   30 * time.Second,
			Transport: otelhttp.NewTransport(http.DefaultTransport), // D4 W3C trace propagation
		}
		// Model B (ADR D1) — control-plane / data-plane credential separation.
		// Control plane: the platform-admin key mints per-tenant data keys via the
		// admin API. Sourced from THEMORY_PLATFORM_ADMIN_KEY (falls back to the
		// legacy THEMORY_API_KEY only as the control-plane credential — NEVER on
		// the data path).
		platformKey := cfg.ThemoryPlatformAdminKey.Value()
		if platformKey == "" {
			platformKey = cfg.ThemoryAPIKey.Value()
		}
		adminClient := themory.NewAdminClient(cfg.ThemoryBaseURL, platformKey, themoryHTTP)
		themoryBroker, brErr := themory.NewBroker(adminClient, 1024, time.Hour,
			[]string{"memory:read", "memory:write", "memory:delete"})
		if brErr != nil {
			logger.Error("failed to construct themory credential broker — refusing to start", "error", brErr)
			os.Exit(1)
		}
		// Data plane: the Bearer is a PER-TENANT theo_live_* resolved from the
		// request's authenticated tenant. The data client holds NO master/platform
		// credential, so a path bug cannot cross tenants — and a mint failure fails
		// the request CLOSED (no master fallback). This closes the confused deputy.
		keyResolver := func(ctx context.Context) (string, error) {
			u := auth.GetUser(ctx)
			if u == nil || u.TenantID == "" {
				return "", fmt.Errorf("themory: no authenticated tenant in context")
			}
			return themoryBroker.KeyForTenant(ctx, u.AccountID, u.TenantID)
		}
		dataClient := themory.NewClient(cfg.ThemoryBaseURL, "", themoryHTTP).WithKeyResolver(keyResolver)
		// Control-plane client for the boot capability probe (GET /v1/openapi.json):
		// uses the platform credential, never a per-tenant key.
		probeClient := themory.NewClient(cfg.ThemoryBaseURL, platformKey, themoryHTTP)

		// platform-api-gateway-edge-slice1 (M6, ADR D1/D7): the ForwardAuth authz
		// endpoint the Traefik edge calls per request. It reuses the SAME inbound
		// validation as RequireScope (auth.ResolveAPIKey) and the SAME per-tenant
		// broker, then returns the minted key for the edge to inject upstream.
		forwardAuthHandler = routes.NewForwardAuthHandler(
			func(ctx context.Context, rawAuthHeader string) (*auth.UserContext, []string, error) {
				return auth.ResolveAPIKey(ctx, db, rawAuthHeader)
			},
			themoryBroker,
			// M1: cross-account guard — does the resolved account own this tenant?
			func(ctx context.Context, accountID, tenantID string) (bool, error) {
				return auth.AccountOwnsTenant(ctx, db, accountID, tenantID)
			},
			"memory:read",
			logger,
		)

		// gateway-themory-integration (D1/D2): register the memory capability with the
		// MCP-aware resolve endpoint the Theo MCP Gateway's BrokerResolver calls. The
		// handler itself is built AFTER this block (M16 D2) so it exists whenever ANY
		// capability (memory OR rag) is configured. theo-workspace#10 — data scope → MCP
		// tool names (the gateway allowlist matches scope==tool exactly). Mirrors
		// theo-memory's REST per-verb scope map (#77): read=recall, write=remember,
		// delete=forget. The downstream minted key keeps the raw data scopes.
		mcpCaps["memory"] = routes.MCPCapabilityBinding{Minter: themoryBroker, RequiredScope: "memory:read", ScopeTools: map[string][]string{
			"memory:read":   {"recall", "episodes", "search_memory", "list_memories"},
			"memory:write":  {"remember", "reflect", "add_skill", "execute_skill", "add_memories"},
			"memory:delete": {"forget", "forget_skill", "delete_memories"},
		}}

		// themory-gateway-provider-capability-guard (F1): fail boot if the provider
		// is REACHABLE but does NOT advertise the scoped-forget DELETE route — a
		// deploy-ordering bug (gateway ahead of TheMemory v0.12.0) that would make
		// forget 404-collapse into a silent not-deleted. Transient failures
		// (unreachable / non-2xx / unparseable openapi) WARN + proceed (ADR D2).
		if cfg.ThemorySkipCapabilityCheck {
			logger.Warn("themory capability guard SKIPPED via THEMORY_SKIP_CAPABILITY_CHECK — forget-by-id correctness is not verified against the provider")
		} else {
			capCtx, capCancel := context.WithTimeout(context.Background(), 10*time.Second)
			capErr := probeClient.AssertScopedForgetSupported(capCtx)
			capCancel()
			switch themory.ClassifyBootCapability(capErr) {
			case themory.BootFatal:
				logger.Error("themory capability guard: provider does not advertise the scoped-forget DELETE route — refusing to start (deploy TheMemory v0.12.0+ first, or set THEMORY_SKIP_CAPABILITY_CHECK=true to override)",
					"error", capErr, "themory_base_url", cfg.ThemoryBaseURL)
				// os.Exit skips deferred cleanup (db.Close/cancel); acceptable on this
				// fatal-boot path — listeners are not started yet and the OS reclaims
				// the just-opened pool on exit (mirrors the other boot os.Exit calls).
				os.Exit(1)
			case themory.BootWarn:
				logger.Warn("themory capability guard: could not verify provider scoped-forget capability (transient) — proceeding",
					"error", capErr)
			case themory.BootProceed:
				logger.Info("themory capability guard: provider advertises scoped-forget DELETE")
			}
		}

		// Memory Webhook Delivery plan T5.6: wire the event publisher so
		// `memory.forgotten` mutations fan out to active webhooks.
		webhookEventPublisher := routes.NewMemoryWebhookEventPublisher(db, logger)
		memoryHandler = routes.NewMemoryHandler(dataClient, logger).WithEventPublisher(webhookEventPublisher)
		logger.Info("memory proxy enabled", "themory_base_url", cfg.ThemoryBaseURL)

		// Plan 3 — Memory Operations (exports + webhooks).
		// Webhooks need only the DB; exports need DB + TheMemory client +
		// a worker-output directory. Both stay nil if Memory itself is
		// disabled, so the /v1/memory/exports/* and /v1/memory/webhooks/*
		// blocks below also remain unregistered when off.
		exportDir := os.Getenv("THEO_EXPORT_DIR")
		if exportDir == "" {
			exportDir = "/tmp/theo-exports"
		}
		workerDelay := 3 * time.Second
		if d := os.Getenv("EXPORT_WORKER_DELAY_MS"); d != "" {
			if parsed, perr := time.ParseDuration(d + "ms"); perr == nil {
				workerDelay = parsed
			}
		}
		memoryWebhooksHandler = routes.NewMemoryWebhooksHandler(db, logger)
		memoryExportsHandler = routes.NewMemoryExportsHandler(db, dataClient, logger, exportDir, workerDelay)

		// BFF (Backend-For-Frontend) surface for the dashboard's browser
		// Model B: the dashboard surface (/v1/dashboard/memory/*) registers the
		// shared MemoryHandler directly under requireJWT (see route block below) —
		// the per-tenant data key is resolved by the broker from the JWT-derived
		// tenant. The old per-user BFFKeyVault (which minted into the cloud DB and
		// discarded the secret) is removed.
		logger.Info("dashboard memory enabled (per-tenant broker)", "mount", "/v1/dashboard/memory")
	} else {
		logger.Warn("THEMORY_BASE_URL not set — /v1/memory/* endpoints disabled")
	}

	// M16 (D2/D4): register the theo-rag MCP capability when the rag broker is configured
	// (RAG_BASE_URL set) — independent of memory. ScopeTools maps rag data scopes → the
	// @usetheo/rag-mcp tool names, so a rag:read key exposes NO write tool; the delete
	// bucket is empty today (rag-mcp has no delete tool). The SAME broker serves the REST
	// ForwardAuth handler AND this MCP binding (one mint cache — consistent per-tenant keys).
	if ragBroker != nil {
		mcpCaps["rag"] = routes.MCPCapabilityBinding{Minter: ragBroker, RequiredScope: "rag:read", ScopeTools: routes.RagScopeTools}
	}

	// theo-promptly#50 — registra a capability `promptly` no resolve MCP, independente de
	// memory e rag. O MESMO broker serve o ForwardAuth do REST e este binding (um cache de
	// mint, chaves per-tenant consistentes).
	//
	// `ScopeTools` espelha o registro POR ESCOPO do proprio servidor MCP (theo-promptly#52):
	// `create_dataset` e a UNICA tool de escrita, e uma chave `promptly:read` nao a alcanca
	// por nenhum dos dois caminhos — o gateway filtra `tools/list` pelo balde, e o promptly
	// nem registra a tool. Se os dois discordassem, a mais frouxa viraria o limite real e
	// ninguem saberia qual delas manda.
	if promptlyBroker != nil {
		mcpCaps["promptly"] = routes.MCPCapabilityBinding{
			Minter:        promptlyBroker,
			RequiredScope: "promptly:read",
			ScopeTools:    routes.PromptlyScopeTools,
		}
	}
	// Build the MCP-resolve handler once, if ANY capability is registered (memory and/or
	// rag). Internal-only (the gateway is the caller); it IS the auth, so no middleware.
	if len(mcpCaps) > 0 {
		mcpResolveHandler = routes.NewMCPResolveHandler(
			func(ctx context.Context, rawAuthHeader string) (*auth.UserContext, []string, error) {
				return auth.ResolveAPIKey(ctx, db, rawAuthHeader)
			},
			func(ctx context.Context, accountID, tenantID string) (bool, error) {
				return auth.AccountOwnsTenant(ctx, db, accountID, tenantID)
			},
			mcpCaps,
			logger,
		)
	}

	// Memory Webhook Delivery plan T5.5 — background dispatcher worker.
	// Only started when both memory proxy AND DB are configured (worker
	// needs both to poll + dispatch).
	var memoryWebhookDeliveriesHandler *routes.MemoryWebhookDeliveriesHandler
	if memoryHandler != nil && db != nil {
		memoryWebhookDeliveriesHandler = routes.NewMemoryWebhookDeliveriesHandler(db, logger)
	}

	// Router
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)

	// Red Team theo-cloud#86 closure (CWE-16 Security Misconfiguration):
	// detect consecutive slashes in the raw request URI (Caddy's
	// `path_regexp` matcher cannot — Caddy normalizes path BEFORE
	// routing) and 308-redirect to the canonical single-slash form.
	// Wired BEFORE auth + log so probing requests never reach handler
	// dispatch and the audit trail records the redirect cleanly.
	r.Use(normalize.PathSlashes)

	// OTel HTTP tracing middleware -- creates a span per request with route info.
	r.Use(func(next http.Handler) http.Handler {
		return otelhttp.NewHandler(next, "cloud-service",
			otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
				return r.Method + " " + r.URL.Path
			}),
		)
	})

	// MEET-040: CORS removed — dashboard is same-origin (cloud.{domain}).
	// All API calls are relative URLs, no cross-origin requests.

	// Request logging — every request gets logged with trace_id for correlation.
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/health" { // Don't log health checks
				attrs := []any{
					"method", r.Method,
					"path", r.URL.Path,
					"remote", r.RemoteAddr,
				}
				sc := trace.SpanContextFromContext(r.Context())
				if sc.IsValid() {
					attrs = append(attrs, "trace_id", sc.TraceID().String())
				}
				logger.Info("request", attrs...)
			}
			next.ServeHTTP(w, r)
		})
	})

	// #338 — a sonda REPROVA quando o servico nao consegue servir.
	//
	// O handler anterior ja calculava `degraded` com o banco fora e terminava sem WriteHeader;
	// sem ele o Go devolve 200, e `wget -qO- .../health` (o healthcheck do compose) so falha em
	// status de erro. A sonda ficava verde sobre um servico incapaz de servir /v1, /engine e o
	// ForwardAuth que a borda consulta para autorizar cada produto.
	//
	// O corpo passa a nomear integracao desligada, reusando o mesmo config.MissingSettings do
	// boot (#334). Reportada, NUNCA gatilho de reprovacao: sao opcionais por ambiente, e reprovar
	// por causa delas derrubaria o container em toda topologia que nao as configura.
	r.Get("/health", routes.NewHealthHandler(healthPinger(db), func() map[string][]string {
		return map[string][]string{
			"skills": config.MissingSettings(
				config.Setting{Name: "SKILLS_BASE_URL", Value: cfg.SkillsBaseURL},
				config.Setting{Name: "SKILLS_PLATFORM_ADMIN_KEY", Value: cfg.SkillsPlatformAdminKey.Value()},
			),
			"promptly": config.MissingSettings(
				config.Setting{Name: "PROMPTLY_BASE_URL", Value: cfg.PromptlyBaseURL},
				config.Setting{Name: "PROMPTLY_PLATFORM_ADMIN_KEY", Value: cfg.PromptlyPlatformAdminKey.Value()},
			),
			"trust": config.MissingSettings(
				config.Setting{Name: "TRUST_BASE_URL", Value: cfg.TrustBaseURL},
				config.Setting{Name: "TRUST_PLATFORM_ADMIN_KEY", Value: cfg.TrustPlatformAdminKey.Value()},
			),
		}
	}).ServeHTTP)

	// /ready — READINESS. Mesma sonda, pergunta diferente: "consigo servir AGORA?". Reprova com
	// a dependencia fora, para que o trafego seja retirado desta instancia. O /health acima
	// NUNCA reprova por dependencia: liveness reprovada MATA o processo, e reiniciar nao
	// conserta um banco fora (LT-038 do theo-trust, LT-040/LT-041 do promptly).
	r.Get("/ready", routes.NewReadyHandler(healthPinger(db), func() map[string][]string {
		return map[string][]string{
			"skills": config.MissingSettings(
				config.Setting{Name: "SKILLS_BASE_URL", Value: cfg.SkillsBaseURL},
				config.Setting{Name: "SKILLS_PLATFORM_ADMIN_KEY", Value: cfg.SkillsPlatformAdminKey.Value()},
			),
			"promptly": config.MissingSettings(
				config.Setting{Name: "PROMPTLY_BASE_URL", Value: cfg.PromptlyBaseURL},
				config.Setting{Name: "PROMPTLY_PLATFORM_ADMIN_KEY", Value: cfg.PromptlyPlatformAdminKey.Value()},
			),
			"trust": config.MissingSettings(
				config.Setting{Name: "TRUST_BASE_URL", Value: cfg.TrustBaseURL},
				config.Setting{Name: "TRUST_PLATFORM_ADMIN_KEY", Value: cfg.TrustPlatformAdminKey.Value()},
			),
		}
	}).ServeHTTP)

	// §4.1+4.2: Metrics endpoint (Prometheus text format)
	r.Get("/metrics", cloudmetrics.Handler())

	// M22 — GET /v1/version: a proveniencia do binario que esta respondendo.
	//
	// AUTH-EXEMPT POR CONTRATO, e registrado aqui fora de qualquer middleware de auth de proposito.
	// Com credencial na frente, "o servico caiu" e "sua credencial esta errada" produzem a MESMA
	// resposta, e nem o operador nem o reconciliador conseguem distinguir — que e exatamente a
	// ambiguidade que este endpoint existe para remover.
	//
	// Ate o M22 este servico CONSUMIA /v1/version de todos os irmaos (internal/serviceversions) e nao
	// servia nenhum: a rota devolvia 404 literal, medido 6/6 contra o edge de public-dev. O
	// reconciliador do host sondava OUTRO endpoint (o agregado do M21, com JWT), lia o 401 dele como
	// "a rota existe" e declarava a proveniencia convergida.
	r.Get("/v1/version", version.Handler())

	// platform-api-gateway-edge-slice1 (M6, ADR D7): internal ForwardAuth authz
	// endpoint. Only the Traefik edge calls it (subrequest) — it is NOT under any
	// auth middleware because it IS the auth. GET + POST so any edge transport works.
	if forwardAuthHandler != nil {
		r.Get(routes.AuthzForwardPath, forwardAuthHandler.ServeHTTP)
		r.Post(routes.AuthzForwardPath, forwardAuthHandler.ServeHTTP)
	}
	// M11: the theo-promptly ForwardAuth endpoint the edge's forward-auth-promptly
	// middleware calls. Same generic handler, distinct path + promptly broker.
	if promptlyForwardAuthHandler != nil {
		r.Get(routes.AuthzForwardPromptlyPath, promptlyForwardAuthHandler.ServeHTTP)
		r.Post(routes.AuthzForwardPromptlyPath, promptlyForwardAuthHandler.ServeHTTP)
	}
	// M38: the theo-lens ForwardAuth endpoint the edge's forward-auth-lens middleware
	// calls. Same generic handler, distinct path + lens broker.
	if lensForwardAuthHandler != nil {
		r.Get(routes.AuthzForwardLensPath, lensForwardAuthHandler.ServeHTTP)
		r.Post(routes.AuthzForwardLensPath, lensForwardAuthHandler.ServeHTTP)
	}
	// M10: the theo-trust ForwardAuth endpoint the edge's forward-auth-trust
	// middleware calls. Same generic handler, distinct path + trust broker.
	if trustForwardAuthHandler != nil {
		r.Get(routes.AuthzForwardTrustPath, trustForwardAuthHandler.ServeHTTP)
		r.Post(routes.AuthzForwardTrustPath, trustForwardAuthHandler.ServeHTTP)
	}
	// M22: the theo-skills ForwardAuth endpoint the edge's forward-auth-skills
	// middleware calls. Same generic handler, distinct path + skills broker.
	if skillsForwardAuthHandler != nil {
		r.Get(routes.AuthzForwardSkillsPath, skillsForwardAuthHandler.ServeHTTP)
		r.Post(routes.AuthzForwardSkillsPath, skillsForwardAuthHandler.ServeHTTP)
	}
	// M14: the theo-rag ForwardAuth endpoint the edge's forward-auth-rag middleware
	// calls. Same generic handler, distinct path + rag broker.
	if ragForwardAuthHandler != nil {
		r.Get(routes.AuthzForwardRagPath, ragForwardAuthHandler.ServeHTTP)
		r.Post(routes.AuthzForwardRagPath, ragForwardAuthHandler.ServeHTTP)
	}
	// gateway-themory-integration: the MCP-aware resolve endpoint the Theo MCP
	// Gateway's BrokerResolver calls. Internal-only (the gateway is the caller),
	// outside any auth middleware because it IS the auth. GET + POST.
	if mcpResolveHandler != nil {
		r.Get(routes.AuthzMCPResolvePath, mcpResolveHandler.ServeHTTP)
		r.Post(routes.AuthzMCPResolvePath, mcpResolveHandler.ServeHTTP)
	}

	// Auth endpoints (no auth — these ARE the auth flow)
	r.Route("/v1/auth", func(r chi.Router) {
		// Device endpoints are unauthenticated — rate-limit per client IP to
		// blunt brute force / abuse (find_sec_007).
		r.With(ratelimit.Middleware(deviceLimiter, 60, ipKey)).Post("/device/authorize", deviceHandler.Authorize)
		r.With(ratelimit.Middleware(deviceLimiter, 60, ipKey)).Post("/device/accept", deviceHandler.Accept)
		r.With(ratelimit.Middleware(deviceLimiter, 60, ipKey)).Post("/device/token", deviceHandler.Token)
		r.With(ratelimit.Middleware(deviceLimiter, 60, ipKey)).Post("/token/refresh", deviceHandler.Refresh)
		r.Post("/session/token", sessionTokenHandler.Exchange) // Dashboard: Kratos session → JWT (rate-limited inside the handler)

		// T3.1 of plan kratos-self-service-rate-limit-systemic v1.1 —
		// response-shape unifier middleware. Unauthenticated (the dashboard
		// register page POSTs without a session). Defense-in-depth:
		// (a) Caddy edge `register_throttle` (5/min, T1.2) on auth-dev block, AND
		// (b) BFF `registerLimiter` (5/min/IP, F-sec-1 absorption) here, which
		// holds even when traffic bypasses the edge (k8s NodePort, dev direct).
		r.With(ratelimit.Middleware(registerLimiter, 5, ipKey)).
			Post("/register", registerProxyHandler.Post)

		// /me requires JWT
		r.With(requireJWT).Get("/me", meHandler.Get)
	})

	// F-arch-1 + Red Team post-fix-verification absorption 2026-06-27:
	// alias mount of the BFF register handler at BOTH Kratos self-service
	// submit paths:
	//   - `/self-service/registration/methods/password` — Kratos API flow
	//     (old shape, kept for compat with direct API clients).
	//   - `/self-service/registration` — Kratos BROWSER flow canonical
	//     (per `ui.action` URL emitted by /self-service/registration/browser).
	//     This is the path the dashboard form actually POSTs to AND the
	//     enumeration attack vector the Red Team exercised: existing email
	//     leaked HTTP 400 "exists" vs new email HTTP 200. The BFF unifier
	//     normalizes both to byte-identical universal 200.
	// The Caddy auth-dev block routes both paths via `handle` (path-
	// preserving) so the BFF must register both URLs explicitly.
	r.With(ratelimit.Middleware(registerLimiter, 5, ipKey)).
		Post("/self-service/registration/methods/password", registerProxyHandler.Post)
	r.With(ratelimit.Middleware(registerLimiter, 5, ipKey)).
		Post("/self-service/registration", registerProxyHandler.Post)

	// Telemetry — T1.2 of plan 2026-05-27-backend-frontend-integration v1.1.
	// PUBLIC (no JWT) — sendBeacon API cannot set custom Authorization
	// headers, so requiring auth would silently drop every beacon. Body cap
	// 64 KiB (EC-03) defends against OOM via hostile / buggy clients.
	telemetryHandler := routes.NewTelemetryHandler(logger)
	r.Route("/v1/telemetry", func(r chi.Router) {
		r.Post("/errors", telemetryHandler.Errors)
		r.Post("/web-vitals", telemetryHandler.WebVitals)
		r.Post("/events", telemetryHandler.Events)
		r.Post("/interactions", telemetryHandler.Interactions)
	})

	// Hydra consent/login callbacks (browser redirects)
	r.Get("/auth/login", consentHandler.Login)
	r.Get("/auth/login/complete", consentHandler.LoginComplete)
	r.Get("/auth/consent", consentHandler.Consent)
	r.Get("/auth/device", consentHandler.DeviceVerify)

	// J-09 T1.1 — GitHub App install handshake (browser redirects).
	// /v1/integrations/github/install sets a CSRF state cookie + 302s to GitHub.
	// /v1/integrations/github/callback validates the state + bounces back to
	// the dashboard, preserving installation_id so the next POST
	// /api/v1/projects/{name}/connect can carry it through.
	loginURL := cfg.AppPublicURL + "/login"
	if cfg.KratosPublicURL != "" {
		loginURL = cfg.KratosPublicURL + "/login"
	}
	ghIntegrations := routes.NewGitHubIntegrationsHandler(
		cfg.GitHubAppSlug,
		cfg.AppPublicURL,
		loginURL,
		cfg.AuthCookieDomain,
		func(req *http.Request) bool {
			// EC-15: cheap session check — we only need a valid Kratos
			// browser session cookie to know the user can complete the
			// connect flow without re-login. Token expiry is handled
			// upstream by /v1/auth/session/token.
			return req.Header.Get("Cookie") != ""
		},
	)
	r.Get("/v1/integrations/github/install", ghIntegrations.InitiateInstall)
	r.Get("/v1/integrations/github/callback", ghIntegrations.Callback)

	// Plan 0 — Platform API Keys (/v1/api-keys/*).
	// D8 dispatch lockdown: this route group uses requireJWT (session cookie
	// from Ory Hydra OIDC). It does NOT use RequireScope — that middleware
	// gates SDK-consumer routes (/v1/memory/* in Plan 1, future verticals
	// thereafter). Mixing the two on the same route would either create a
	// bootstrap loop (Bearer key needs CRUD via Bearer key) or leak the key-
	// management surface to production agents.
	r.Route("/v1/api-keys", func(r chi.Router) {
		r.Use(requireJWT)
		// Per-user rate limit reuses the billingLimiter pool (30 rpm).
		// API key CRUD is a low-volume operation by definition.
		r.Use(ratelimit.Middleware(billingLimiter, 30, userKey))
		r.Get("/list", apiKeysHandler.ListKeys)
		r.Post("/", apiKeysHandler.CreateKey)
		r.Delete("/{id}", apiKeysHandler.RevokeKey)
		// API Key Rotation plan T6.3 (closes Plan 0 D6 deferral).
		r.Post("/{id}/rotate", apiKeysHandler.RotateKey)
		// API Key Lineage View plan T7.3 (closes API Key Rotation OOS #4).
		r.Get("/{id}/lineage", apiKeysHandler.LineageKey)
	})

	// Plan 1 — Memory Shell (/v1/memory/*).
	// D8 dispatch + D2 scope mapping: each route uses RequireScope(db, scope)
	// — the SDK-consumer surface authenticated by theo_live_* Bearer keys.
	// /v1/api-keys/* (above) and /v1/memory/* (here) intentionally use
	// distinct middleware so a customer can never CRUD keys via Bearer or
	// query memory via session cookie (closes both directions of the loop).
	if memoryHandler != nil {
		r.Route("/v1/memory", func(r chi.Router) {
			r.With(auth.RequireScope(db, "memory:read")).Get("/list", memoryHandler.List)
			r.With(auth.RequireScope(db, "memory:read")).Get("/metrics", memoryHandler.Metrics)
			r.With(auth.RequireScope(db, "memory:delete")).Delete("/forget/{memoryID}", memoryHandler.Forget)
			// Plan 2 (Memory Insights) — entities aggregated by scope.
			// Same scope as List + Metrics per D2 (no per-feature scope explosion).
			r.With(auth.RequireScope(db, "memory:read")).Get("/entities", memoryHandler.Entities)
			// themory-graph-gateway-dashboard — entity relation graph ({nodes,edges}).
			// Same memory:read scope as entities (shared handler, D2).
			r.With(auth.RequireScope(db, "memory:read")).Get("/graph", memoryHandler.Graph)
			// episodes-gateway-dashboard — cursor-paginated bi-temporal episode log.
			r.With(auth.RequireScope(db, "memory:read")).Get("/episodes", memoryHandler.Episodes)
			// dashboard-phase2b-skills-browse T3.2 — read-only Repo-tier skills
			// listing (same memory:read scope; repoId namespaced by subject, D3).
			r.With(auth.RequireScope(db, "memory:read")).Get("/skills", memoryHandler.ListSkills)
			// skills-cross-repo-sdk-symmetry M3 — cross-repo flat skills list on the
			// SDK surface (SDK twin of the BFF /skills/all). Same memory:read scope
			// as per-repo /skills; bare subject (D1). Static `/skills/all` does not
			// collide with `/skills` or `/skills/{skillID}` in chi.
			r.With(auth.RequireScope(db, "memory:read")).Get("/skills/all", memoryHandler.ListSkillsAll)
			// skills-write-surface T3.2 — author (write) + curate (delete) skills.
			r.With(auth.RequireScope(db, "memory:write")).Post("/skills", memoryHandler.AddSkill)
			r.With(auth.RequireScope(db, "memory:delete")).Delete("/skills/{skillID}", memoryHandler.ForgetSkill)
			// theo-memory-dashboard-full-integration T1.2 — the 3 core verbs on
			// the SDK surface (remember/reflect = write; recall = read).
			r.With(auth.RequireScope(db, "memory:write")).Post("/remember", memoryHandler.Remember)
			r.With(auth.RequireScope(db, "memory:read")).Post("/recall", memoryHandler.Recall)
			r.With(auth.RequireScope(db, "memory:write")).Post("/reflect", memoryHandler.Reflect)

			// Plan 3 (Memory Operations) — webhooks + exports.
			// All gated by memory:admin per least-privilege (these affect
			// downstream consumers + can exfiltrate data).
			if memoryWebhooksHandler != nil {
				r.With(auth.RequireScope(db, "memory:admin")).Post("/webhooks", memoryWebhooksHandler.Create)
				r.With(auth.RequireScope(db, "memory:admin")).Get("/webhooks/list", memoryWebhooksHandler.List)
				r.With(auth.RequireScope(db, "memory:admin")).Delete("/webhooks/{id}", memoryWebhooksHandler.Delete)
			}
			if memoryExportsHandler != nil {
				r.With(auth.RequireScope(db, "memory:admin")).Post("/exports", memoryExportsHandler.Create)
				r.With(auth.RequireScope(db, "memory:admin")).Get("/exports/{id}/status", memoryExportsHandler.Status)
				r.With(auth.RequireScope(db, "memory:admin")).Get("/exports/{id}/download", memoryExportsHandler.Download)
			}

			// Memory Webhook Delivery plan T5.7 — deliveries history per webhook.
			if memoryWebhookDeliveriesHandler != nil {
				r.With(auth.RequireScope(db, "memory:admin")).Get("/webhooks/{id}/deliveries", memoryWebhookDeliveriesHandler.List)
				// Delivery Replay plan T8.3 — manual re-trigger for a failed delivery.
				// Distinct path-param names ({webhook_id}, {delivery_id}) match the
				// handler's chi.URLParam reads.
				r.With(auth.RequireScope(db, "memory:admin")).Post(
					"/webhooks/{webhook_id}/deliveries/{delivery_id}/replay",
					memoryWebhookDeliveriesHandler.Replay,
				)
			}
		})
	}

	// M7 tenant blob storage vertical (/v1/storage/*). Gated on config: enabled
	// only when the S3 backend is configured (config.StorageEnabled). Uses
	// RequireScope(db, storage:*) like the other consumer verticals — in-process,
	// no broker/ForwardAuth. The share-redemption route is UNauthenticated (the
	// token is the capability) and therefore IP-rate-limited.
	if cfg.StorageEnabled() {
		// DIP swap: proxy mode forwards to the standalone theo-storage service;
		// in-process mode runs the S3-backed vertical here. Both satisfy the same
		// routes.StorageService interface, so the routes below are identical.
		var storageSvc routes.StorageService
		if cfg.StorageProxyMode() {
			storageSvc = storageproxy.New(cfg.StorageUpstreamURL, nil)
			logger.Info("storage vertical enabled (thin proxy)", "upstream", cfg.StorageUpstreamURL)
		} else {
			s, err := storage.BuildService(db, storage.BackendConfig{
				S3Endpoint:       cfg.StorageS3Endpoint,
				S3PublicEndpoint: cfg.StorageS3PublicEndpoint,
				S3Bucket:         cfg.StorageS3Bucket,
				S3Region:         cfg.StorageS3Region,
				S3AccessKey:      cfg.StorageS3AccessKey.Value(),
				S3SecretKey:      cfg.StorageS3SecretKey.Value(),
				ShareSecret:      cfg.StorageShareSecret.Value(),
			})
			if err != nil {
				logger.Error("storage vertical build failed", "error", err)
				os.Exit(1)
			}
			storageSvc = s
		}
		storageHandler := routes.NewStorageHandler(storageSvc)
		shareRedeemLimiter := ratelimit.NewInMemoryLimiter(60, time.Minute)
		r.Route("/v1/storage", func(r chi.Router) {
			r.With(auth.RequireScope(db, "storage:write")).Put("/objects/*", storageHandler.Upload)
			r.With(auth.RequireScope(db, "storage:read")).Get("/objects/*", storageHandler.Download)
			r.With(auth.RequireScope(db, "storage:read")).Get("/objects", storageHandler.List)
			r.With(auth.RequireScope(db, "storage:read")).Get("/stat/*", storageHandler.Stat)
			r.With(auth.RequireScope(db, "storage:write")).Delete("/objects/*", storageHandler.Delete)
			r.With(auth.RequireScope(db, "storage:write")).Post("/share", storageHandler.CreateShare)
			// Unauthenticated redemption — token is the capability; IP rate-limited.
			r.With(ratelimit.Middleware(shareRedeemLimiter, 60, ipKey)).Get("/shared/{token}", storageHandler.RedeemShare)
		})
		// Dashboard BFF surface (/v1/dashboard/storage/*) — browser JWT sessions.
		// Reuses the SAME StorageHandler: tenant comes from auth.GetUser(ctx),
		// which requireJWT populates identically to the scope middleware (DRY).
		r.Route("/v1/dashboard/storage", func(r chi.Router) {
			r.Use(requireJWT)
			storageHandler.MountDashboardRoutes(r)
		})
		logger.Info("storage vertical enabled", "endpoint_configured", true)
	} else {
		logger.Warn("STORAGE_S3_* not set — /v1/storage/* endpoints disabled")
	}

	// Dashboard surface (/v1/dashboard/memory/*) — browser sessions (requireJWT).
	// Model B: registers the SAME handlers the SDK surface uses, under the
	// session-JWT chain. The per-tenant data key is resolved by the broker from
	// the JWT-derived tenant — no per-user vault, no master key (BFFKeyVault +
	// the ~21 mintOrFail wrappers were removed). Distinct mount from /v1/memory/*
	// so a session can never be used as an SDK key, and vice-versa.
	//
	// SECURITY INVARIANT (F-xval-3, preserved): exports/webhooks ops are
	// memory:admin on the SDK surface; here they sit behind requireJWT ONLY,
	// correct for the dashboard's single-subject-per-customer model — every ops
	// handler scopes strictly to auth.GetUser(...).Subject. If a future RBAC
	// member/non-admin dashboard session is introduced, gate with requireRole(admin).
	if memoryHandler != nil {
		r.Route("/v1/dashboard/memory", func(r chi.Router) {
			r.Use(requireJWT)
			r.Get("/list", memoryHandler.List)
			r.Get("/sessions", memoryHandler.Sessions)
			r.Get("/metrics", memoryHandler.Metrics)
			r.Get("/entities", memoryHandler.Entities)
			r.Get("/graph", memoryHandler.Graph)
			r.Get("/episodes", memoryHandler.Episodes)
			r.Get("/skills", memoryHandler.ListSkills)
			r.Get("/skills/all", memoryHandler.ListSkillsAll)
			r.Post("/skills", memoryHandler.AddSkill)
			r.Delete("/skills/{skillID}", memoryHandler.ForgetSkill)
			r.Delete("/forget/{memoryID}", memoryHandler.Forget)
			r.Post("/remember", memoryHandler.Remember)
			r.Post("/recall", memoryHandler.Recall)
			r.Post("/reflect", memoryHandler.Reflect)
			if memoryExportsHandler != nil {
				r.Post("/exports", memoryExportsHandler.Create)
				r.Get("/exports/{id}/status", memoryExportsHandler.Status)
				r.Get("/exports/{id}/download", memoryExportsHandler.Download)
			}
			if memoryWebhooksHandler != nil {
				r.Post("/webhooks", memoryWebhooksHandler.Create)
				r.Get("/webhooks/list", memoryWebhooksHandler.List)
				r.Delete("/webhooks/{id}", memoryWebhooksHandler.Delete)
			}
			if memoryWebhookDeliveriesHandler != nil {
				r.Get("/webhooks/{id}/deliveries", memoryWebhookDeliveriesHandler.List)
				r.Post("/webhooks/{webhook_id}/deliveries/{delivery_id}/replay", memoryWebhookDeliveriesHandler.Replay)
			}
		})
	}

	// M17: read+write /v1/dashboard/rag BFF (M21) (browser sessions, requireJWT). read+write (M21) —
	// no mutating verb (the read-only route-set test enforces this); the per-tenant key
	// is minted rag:read+write+delete (M21). Distinct mount from /v1/rag/* (the SDK/edge surface).
	if ragDashboardHandler != nil {
		mountRagDashboard(r, ragDashboardHandler, ragConnectorsOAuth, requireJWT)
	}
	// M8 OAuth broker browser-redirect endpoints (#199) — root path, NO requireJWT: these are
	// top-level navigations authenticated by the Kratos session cookie (like the GitHub App
	// callback), not Bearer JWTs. Mounted here (not under /v1/dashboard/rag) so the callback and
	// its CSRF/PKCE cookies live on this (BFF) origin.
	if ragConnectorsOAuth != nil {
		r.Get("/v1/rag-connect/{provider}/authorize", ragConnectorsOAuth.Authorize)
		r.Get("/v1/rag-connect/{provider}/callback", ragConnectorsOAuth.Callback)
	}
	// M44: the read+write+delete /v1/dashboard/lens management BFF — the per-tenant key is
	// minted observability:read+write+delete (ADR-1; per-verb least privilege at theo-lens). The route
	// set (ADR-3) has no mutating verb on the trace/session body or /agents. Distinct mount
	// from /v1/lens/* (the edge surface).
	if lensDashboardHandler != nil {
		routes.MountLensDashboard(r, lensDashboardHandler, requireJWT)
	}
	// M23 — BFF de leitura da capacidade trust. Montado só quando TRUST_BASE_URL está configurado;
	// sem broker não há cunhagem por tenant, e sem ela a rota não deve existir.
	if trustDashboardHandler != nil {
		routes.MountTrustDashboard(r, trustDashboardHandler, requireJWT)
	}
	if trustGuardrailsHandler != nil {
		routes.MountTrustGuardrails(r, trustGuardrailsHandler, requireJWT)
	}
	// M25 — catálogo de prompts, revisões e promoção de label. Mesmo gate dos demais: montado só
	// quando o broker existe.
	if promptlyDashboardHandler != nil {
		routes.MountPromptlyDashboard(r, promptlyDashboardHandler, requireJWT)
	}
	// M26 — registro de skills (leitura). Mesmo gate dos demais: sem broker não há cunhagem por
	// inquilino, e sem ela a rota não deve existir. Montá-la assim mesmo daria 502 a toda
	// requisição — uma capacidade que parece implantada e não está.
	if skillsDashboardHandler != nil {
		routes.MountSkillsDashboard(r, skillsDashboardHandler, requireJWT)
	}
	// M26 T3.5 — a promocao e montada a parte, e so quando o broker existe. Uma rota de MUTACAO
	// sem cunhagem por inquilino nao deve existir: ela responderia 502 a toda tentativa, e o
	// operador leria indisponibilidade onde o defeito e de configuracao.
	if skillsPromotionHandler != nil {
		routes.MountSkillsPromotion(r, skillsPromotionHandler, requireJWT)
	}
	// M52: lens saved views — a cloud-owned per-tenant preference store (raw Postgres, engine
	// migration 000053). Gated on the shared DB (not the lens broker), so saved views work even
	// when the per-tenant lens broker is disabled.
	if db != nil {
		routes.MountLensSavedViews(r, routes.NewLensSavedViewsHandler(db, logger), requireJWT)
	}
	// M53: lens alert rules — per-tenant threshold rules (engine migration 000054). Same db-gated
	// cloud-owned Postgres resource; the evaluator worker that consumes them starts below.
	if db != nil {
		routes.MountLensAlertRules(r, routes.NewLensAlertRulesHandler(db, monitorOwnershipVerifier(cfg.LensBaseURL, lensBroker), logger), requireJWT)
	}
	// M66: lens custom dashboards — per-workspace board config (engine migration 000055). Same
	// db-gated cloud-owned Postgres resource; the board data reads through the lens BFF above.
	if db != nil {
		routes.MountLensDashboards(r, routes.NewLensDashboardsHandler(db, logger), requireJWT)
	}
	// M21: the sidebar's status dot stops being a JSX literal and starts deriving
	// from a real probe of each data-plane service's /v1/version.
	mountServiceVersions(r, cfg, logger, requireJWT)

	// Memory Webhook Delivery plan T5.5: the dispatcher worker is started
	// below alongside the metering scheduler, sharing the schedulerCtx for
	// graceful shutdown. See the `if db != nil && stripeClient != nil`
	// block + adjacent worker spawn.

	// Billing endpoints (JWT required via middleware, except webhook)
	if billingHandler != nil {
		r.Route("/v1/billing", func(r chi.Router) {
			r.Use(requireJWT)
			// Per-user rate limit on billing endpoints (find_sec_007).
			r.Use(ratelimit.Middleware(billingLimiter, 30, userKey))
			// Reading billing status is allowed for any member of the team.
			r.Get("/", billingHandler.GetBilling)
			// Mutating billing (opening the Stripe portal, starting checkout) is
			// owner-only. Role is resolved from the DB (S2.3), never the token.
			r.With(auth.RequireRole(tenantProvisioner, "owner")).Get("/portal", billingHandler.Portal)
			r.With(auth.RequireRole(tenantProvisioner, "owner")).Post("/checkout", billingHandler.Checkout)
			// Invoices are financial records — owner-only (MEET-2026-07-03-004 D2),
			// stricter than the team-readable plan/usage above. Role resolved from
			// the DB, never the token; a non-owner gets 403 here (H4).
			r.With(auth.RequireRole(tenantProvisioner, "owner")).Get("/invoices", billingHandler.GetInvoices)
		})
		// Webhook — NO JWT (Stripe signs with its own secret)
		r.Post("/v1/webhooks/stripe", billingHandler.Webhook)
	}

	// J-16 Settings — workspace/deploy webhook registrations (owner-only; a
	// privileged workspace config, mirroring billing's owner gate). Registration
	// -only v0.1 — delivery is a later T2 slice. Persists to workspace_webhooks
	// (engine migration 000050). Path is /v1/settings/webhooks to avoid colliding
	// with the Stripe/GitHub inbound webhook receivers under /v1/webhooks/*.
	if db != nil {
		wwh := routes.NewWorkspaceWebhooksHandler(db, logger)
		r.Route("/v1/settings/webhooks", func(r chi.Router) {
			r.Use(requireJWT)
			r.With(auth.RequireRole(tenantProvisioner, "owner")).Post("/", wwh.Create)
			r.With(auth.RequireRole(tenantProvisioner, "owner")).Get("/list", wwh.List)
			r.With(auth.RequireRole(tenantProvisioner, "owner")).Get("/{id}/deliveries", wwh.Deliveries)
			r.With(auth.RequireRole(tenantProvisioner, "owner")).Delete("/{id}", wwh.Delete)
		})
	}

	// Engine API proxy — dashboard calls engine through cloud service.
	// The engine only accepts RSA tokens (aud=theo-engine) or internal service auth.
	// Dashboard has HMAC tokens, so cloud authenticates to engine via X-Service-Auth.
	engineURL := cfg.EngineAPIURL
	serviceSecret := string(cfg.ServiceAuthSecret)

	// Dual-control Ed25519 signer (ADR 2026-05-13). The cloud proxy
	// signs the canonical payload (user, tenant, ts, nonce, method+path)
	// in addition to sending the shared secret. Phase 1: signer is
	// optional — if THEO_SERVICE_AUTH_ED25519_PRIVATE_KEY is empty, the
	// proxy degrades gracefully to single-control. The engine middleware
	// counts present-vs-absent and the operator flips to Phase 2 when
	// the 7-day coverage soak hits 100% (RFC Q3).
	var serviceSigner *auth.ServiceSigner
	if ed25519Key := os.Getenv("THEO_SERVICE_AUTH_ED25519_PRIVATE_KEY"); ed25519Key != "" {
		serviceSigner, err = auth.NewServiceSignerFromBase64(ed25519Key)
		if err != nil {
			// Per RFC Q5 fail-closed: a misconfigured key MUST NOT silently
			// degrade to single-control. Crash at startup so the readiness
			// probe stops the rollout instead of accepting traffic without
			// the dual-control gate.
			logger.Error("service-auth Ed25519 signer init failed", "error", err)
			os.Exit(1)
		}
		logger.Info("service-auth Ed25519 dual-control signer enabled")
	} else {
		logger.Warn("service-auth Ed25519 private key not configured — Phase 1 single-control only; set THEO_SERVICE_AUTH_ED25519_PRIVATE_KEY to enable dual-control")
	}

	// LIVE-caught 2026-06-18: 30s timeout was killing legitimate
	// long-running engine ops (rollback waits for ArgoCD sync ≤ 120s,
	// promote, deep status). Client timeout MUST exceed the engine
	// handler ceiling (150s) so the engine has time to either succeed
	// OR write its own ROLLBACK_FAILED state. Without this header,
	// the BFF kills the request mid-sync-wait and the engine can't
	// even surface "sync timeout" properly to the dashboard.
	engineClient := &http.Client{
		Timeout:   180 * time.Second,
		Transport: otelhttp.NewTransport(http.DefaultTransport),
	}
	// CANONICAL FIX 2026-06-15 (FAANG): GitHub webhook authenticates via
	// HMAC signature (X-Hub-Signature-256 header) — NOT Bearer JWT. The
	// requireJWT middleware was wrongly blocking webhook deliveries on
	// the /engine path. Webhook subtree is exempted from JWT and proxied
	// raw to theo-api where the canonical signature verification runs
	// (api/cmd/setup_github.go reads GITHUB_WEBHOOK_SECRET). All other
	// /engine/* paths still require JWT auth.
	r.HandleFunc("/engine/api/v1/webhooks/*", func(w http.ResponseWriter, r *http.Request) {
		targetPath := strings.TrimPrefix(r.URL.Path, "/engine")
		// #nosec G404 — webhook endpoint authenticates via HMAC signature
		// downstream (theo-api setup_github.go ConstantTimeCompare); cloud
		// is a pass-through proxy here.
		proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, engineURL+targetPath, r.Body)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]string{"code": "SERVICE_ERROR", "message": "Service temporarily unavailable. Try again."})
			return
		}
		proxyReq.URL.RawQuery = r.URL.RawQuery
		// Preserve canonical webhook headers (signature + delivery + event)
		// so theo-api can verify HMAC.
		for _, h := range []string{
			"Content-Type",
			"X-Hub-Signature-256",
			"X-Hub-Signature",
			"X-GitHub-Event",
			"X-GitHub-Delivery",
			"User-Agent",
			"X-Correlation-Id",
			"X-Request-Id",
		} {
			if v := r.Header.Get(h); v != "" {
				proxyReq.Header.Set(h, v)
			}
		}
		// Internal service auth so theo-api accepts the proxied call
		// without Bearer (sets X-Theo-User-ID="webhook" sentinel via
		// engine's webhook auth bypass).
		proxyReq.Header.Set("X-Service-Auth", serviceSecret)
		resp, perr := engineClient.Do(proxyReq)
		if perr != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]string{"code": "SERVICE_UNAVAILABLE", "message": "Service temporarily unavailable. Try again."})
			return
		}
		defer func() { _ = resp.Body.Close() }()
		for k, v := range resp.Header {
			for _, vv := range v {
				w.Header().Add(k, vv)
			}
		}
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
	})

	r.Route("/engine", func(r chi.Router) {
		r.Use(requireJWT) // Dashboard must be authenticated
		r.HandleFunc("/*", func(w http.ResponseWriter, r *http.Request) {
			// Strip /engine prefix and forward to engine API
			targetPath := strings.TrimPrefix(r.URL.Path, "/engine")
			if targetPath == "" {
				targetPath = "/"
			}

			// #nosec G704 -- authenticated reverse proxy (requireJWT); host is the operator-configured EngineAPIURL, only the path is forwarded by design.
			proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, engineURL+targetPath, r.Body)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadGateway)
				_ = json.NewEncoder(w).Encode(map[string]string{"code": "SERVICE_ERROR", "message": "Service temporarily unavailable. Try again."})
				return
			}
			// Forward query params, content type, and correlation ID
			proxyReq.URL.RawQuery = r.URL.RawQuery
			proxyReq.Header.Set("Content-Type", r.Header.Get("Content-Type"))
			if cid := r.Header.Get("X-Correlation-Id"); cid != "" {
				proxyReq.Header.Set("X-Correlation-Id", cid)
			}
			if rid := r.Header.Get("X-Request-Id"); rid != "" {
				proxyReq.Header.Set("X-Request-Id", rid)
			}
			// CANONICAL FIX 2026-06-15: forward Idempotency-Key header. theo-api
			// requires Idempotency-Key on mutating routes (POST/PATCH/DELETE per
			// router.go idempotentMiddlewares — D/Domains/Secrets/Bulk/etc).
			// Prior proxy implementation only forwarded Content-Type + correlation
			// headers, causing dogfood --live-only tests that target /engine/*
			// mutating paths to fail with MISSING_IDEMPOTENCY_KEY even when the
			// client correctly set the header.
			if ik := r.Header.Get("Idempotency-Key"); ik != "" {
				proxyReq.Header.Set("Idempotency-Key", ik)
			}

			// Service-to-service auth: cloud authenticates to engine via shared secret.
			// S2.3: Proxy sends identity only (user ID, tenant, email). Engine resolves
			// role from DB — never trusts role from headers.
			proxyReq.Header.Set("X-Service-Auth", serviceSecret)
			user := auth.GetUser(r.Context())
			if user != nil {
				proxyReq.Header.Set("X-Theo-User-ID", user.Subject)
				proxyReq.Header.Set("X-Theo-Tenant", user.TenantID)
				proxyReq.Header.Set("X-Theo-Email", user.Email)
				// X-Theo-Role intentionally NOT sent — engine resolves from DB (S2.3)

				// Dual-control Ed25519 (ADR 2026-05-13). Attach AFTER identity
				// headers are set — Attach hashes user+tenant+method+path into
				// the canonical payload. A signing failure (missing identity,
				// nonce-rng exhaustion) returns 502 to dashboard caller rather
				// than silently proceeding without the signature.
				if serviceSigner != nil {
					if sErr := serviceSigner.Attach(proxyReq); sErr != nil {
						logger.Warn("service-auth signature attach failed", "error", sErr, "path", targetPath)
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusBadGateway)
						// O erro do Encode nao tem acao possivel: o status ja foi escrito, entao
						// nao ha como mudar a resposta, e falhar aqui significa que o cliente
						// desapareceu. `_ =` registra que a decisao foi tomada em vez de deixar o
						// leitor supondo — a diferenca entre "avaliamos e ignoramos" e "ninguem olhou".
						_ = json.NewEncoder(w).Encode(map[string]string{"code": "SERVICE_AUTH_SIGN_FAILED", "message": "Service authentication failure. Try again."})
						return
					}
				}
			}

			// #nosec G704 -- authenticated reverse proxy (requireJWT); destination host is the operator-configured EngineAPIURL, not attacker-controlled.
			resp, err := engineClient.Do(proxyReq)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadGateway)
				_ = json.NewEncoder(w).Encode(map[string]string{"code": "SERVICE_UNAVAILABLE", "message": "Service temporarily unavailable. Try again."})
				return
			}
			defer func() { _ = resp.Body.Close() }()

			// Copy response headers and body
			for k, v := range resp.Header {
				for _, vv := range v {
					w.Header().Add(k, vv)
				}
			}
			w.WriteHeader(resp.StatusCode)

			// CANONICAL FIX 2026-06-15 (re-asserted): SSE responses require
			// per-chunk Flush; bare io.Copy buffers until backend EOF which
			// never arrives on long-lived event streams. Detect SSE via
			// Content-Type + use http.Flusher per chunk so EventSource
			// clients (dashboard) + curl -N (dogfood tests) see events as
			// they arrive instead of timing out with 0 bytes. Closes the
			// dev-public-deployments-flow_test.sh Scenario B regression
			// (curl -m 8 returned 0 bytes received before this fix).
			// Memory: feedback_theo_cloud_sse_proxy_buffers_until_eof_2026_06_13
			if strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
				flusher, _ := w.(http.Flusher)
				// Flush response headers IMMEDIATELY so EventSource onopen()
				// fires + curl -N sees HTTP 200 + Content-Type:text/event-stream
				// even before the first data frame. Per RFC 8941 + HTTP/2
				// requirement: headers must be sent in a HEADERS frame
				// independent of subsequent DATA frames.
				if flusher != nil {
					flusher.Flush()
				}
				buf := make([]byte, 4096)
				for {
					n, rerr := resp.Body.Read(buf)
					if n > 0 {
						if _, werr := w.Write(buf[:n]); werr != nil {
							return
						}
						if flusher != nil {
							flusher.Flush()
						}
					}
					if rerr != nil {
						return
					}
				}
			}

			_, _ = io.Copy(w, resp.Body)
		})
	})

	// Start metering scheduler (background goroutines)
	schedulerCtx, schedulerCancel := context.WithCancel(context.Background())
	if db != nil && stripeClient != nil {
		reporter := metering.NewReporter(db, stripeClient, logger)
		reconciler := metering.NewReconciler(db, logger)
		go metering.StartScheduler(schedulerCtx, reporter, reconciler, logger)
	}

	// Memory Webhook Delivery plan T5.5 — dispatcher worker goroutine.
	// Sharing schedulerCtx ensures graceful shutdown on SIGTERM. The
	// worker drains in-flight dispatches before exiting Run().
	if memoryHandler != nil && db != nil {
		webhookWorker := memory_webhook_worker.New(db, logger, nil)
		go webhookWorker.Run(schedulerCtx)
		logger.Info("memory webhook dispatcher started")
	}

	// J-16 slice 3: dispatch workspace_webhook_deliveries (deploy/build events)
	// to customer URLs through the SSRF-guarded client, with a lease + reaper.
	if db != nil {
		wsWorker := workspace_webhook_worker.New(db, logger, os.Getenv("HOSTNAME"))
		go wsWorker.Run(schedulerCtx)
		logger.Info("workspace webhook dispatcher started")
	}

	// M53: lens alert evaluator — ticks over lens_alert_rules, fetches each tenant's observability
	// series via a broker-minted observability:read key (Model B, least privilege — platform-admin
	// stays control-plane), evaluates the threshold, and on a breach INSERTs a workspace_webhook_deliveries
	// row (the wsWorker above dispatches it SSRF-guarded). Gated on the DB AND the lens broker being
	// configured (LENS_BASE_URL set); nil-safe otherwise.
	if db != nil && lensBroker != nil {
		fetch := func(ctx context.Context, tenantID string, windowSeconds int) (json.RawMessage, error) {
			// Per-tenant DataClient: the resolver mints observability:read for THIS tenant (no JWT).
			dc := thelens.NewDataClient(cfg.LensBaseURL, &http.Client{Timeout: 10 * time.Second}).
				WithKeyResolver(func(ctx context.Context) (string, error) {
					return lensBroker.KeyForTenantScoped(ctx, "", tenantID, []string{"observability:read"})
				})
			return dc.Observability(ctx, lens_alert_evaluator.WindowToRange(windowSeconds))
		}
		// M135: guard-backed rules read a per-guard carrier, not the workspace series. A definitive
		// 404 is translated to the typed sentinel so the evaluator can disable a rule whose guard is
		// gone, while a transport error keeps retrying — the two must never collapse into one error.
		fetchMonitor := func(ctx context.Context, tenantID, monitorID string, windowSeconds int) (lens_alert_evaluator.MonitorBreachWindow, error) {
			dc := thelens.NewDataClient(cfg.LensBaseURL, &http.Client{Timeout: 10 * time.Second}).
				WithKeyResolver(func(ctx context.Context) (string, error) {
					return lensBroker.KeyForTenantScoped(ctx, "", tenantID, []string{"observability:read"})
				})
			raw, err := dc.MonitorBreachWindow(ctx, monitorID, windowSeconds)
			if err != nil {
				var us *thelens.UpstreamStatusError
				// 403 is classified as definitive here for the same reason the create-time verifier
				// does: a key that cannot read this guard will not start being able to on retry.
				// The two call sites classifying the same status oppositely was itself a defect.
				if errors.As(err, &us) &&
					(us.Status == http.StatusNotFound || us.Status == http.StatusForbidden) {
					return lens_alert_evaluator.MonitorBreachWindow{}, lens_alert_evaluator.ErrMonitorNotFound
				}
				return lens_alert_evaluator.MonitorBreachWindow{}, err
			}
			var w lens_alert_evaluator.MonitorBreachWindow
			if err := json.Unmarshal(raw, &w); err != nil {
				return lens_alert_evaluator.MonitorBreachWindow{}, err
			}
			return w, nil
		}
		go lens_alert_evaluator.New(db, fetch, fetchMonitor, logger).Run(schedulerCtx)
		logger.Info("lens alert evaluator started")
	}

	// J-16 slice 3: drain the deploy_events outbox (engine migration 000051)
	// and fan each event out to subscribed workspace_webhooks as delivery rows.
	// Pure DB fan-out (no outbound HTTP) — the delivery worker dispatches. Until
	// the full chain is live it produces ~zero rows (no subscribed webhooks).
	if db != nil {
		enq := deploy_event_enqueuer.New(db, logger)
		go enq.Run(schedulerCtx)
		logger.Info("deploy-event enqueuer started")
	}

	// T1.9 production deployment: start cost aggregator if Prometheus
	// is configured. Opt-in via THEO_PROMETHEUS_URL — when unset, the
	// aggregator stays disabled and cost_counters remain empty (the API
	// middleware fails-open). Interval defaults to 5 min, overridable
	// via THEO_COST_AGGREGATOR_INTERVAL.
	if db != nil {
		if promURL := strings.TrimSpace(os.Getenv("THEO_PROMETHEUS_URL")); promURL != "" {
			prom, perr := billing.NewHTTPPromQuerier(promURL, logger)
			if perr != nil {
				logger.Error("cost aggregator: prometheus client init failed; aggregator disabled",
					"error", perr,
					"prometheus_url", promURL)
			} else {
				interval := 5 * time.Minute
				if iv := os.Getenv("THEO_COST_AGGREGATOR_INTERVAL"); iv != "" {
					if parsed, perr := time.ParseDuration(iv); perr == nil && parsed > 0 {
						interval = parsed
					}
				}
				aggregator := billing.NewCostAggregator(db, prom, logger)
				go aggregator.Run(schedulerCtx, interval)
				logger.Info("cost aggregator started",
					"prometheus_url", promURL,
					"interval", interval.String())
			}
		} else {
			logger.Info("cost aggregator disabled (THEO_PROMETHEUS_URL not set)")
		}
	}

	// Start server
	//
	// WriteTimeout MUST exceed the longest-running proxied operation
	// (rollback ≤ 150s engine handler + 30s ArgoCD sync wait grace).
	// Previous 30s caused BFF to cut the connection mid-sync wait;
	// dashboard saw a network error with no useful body.
	srv := &http.Server{
		Addr:         cfg.ListenAddr,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 200 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		logger.Info("shutting down cloud service")
		schedulerCancel() // Stop background metering jobs
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
		if tracingShutdown != nil {
			if err := tracingShutdown(ctx); err != nil {
				logger.Warn("tracing shutdown error", "error", err)
			}
		}
		if db != nil {
			_ = db.Close()
		}
	}()

	logger.Info("cloud auth service starting",
		"addr", cfg.ListenAddr,
		"hydra_public", cfg.HydraPublicURL,
		"kratos_public", cfg.KratosPublicURL,
		"client_id", cfg.HydraClientID,
	)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		logger.Error("server failed", "error", err)
		os.Exit(1)
	}
}

// monitorOwnershipVerifier answers "does this guard exist AND belong to this tenant?" on the alert-rule
// create path. It mints a per-tenant observability:read key, so a guard belonging to another tenant
// is simply not visible — the check is tenant-scoped by construction rather than by a WHERE clause
// we could forget. There is no FK on monitor_id (guards live in theo-lens), so this is the only
// create-time guarantee that exists.
//
// A 404 is DEFINITIVE and rejects the create; anything else is transport and is reported as such, so
// the caller can accept the rule rather than import theo-lens's availability into our write path.
func monitorOwnershipVerifier(lensBaseURL string, broker routes.TenantKeyMinter) routes.MonitorOwnershipVerifier {
	if broker == nil || lensBaseURL == "" {
		return nil
	}
	return func(ctx context.Context, tenantID, monitorID string) error {
		dc := thelens.NewDataClient(lensBaseURL, &http.Client{Timeout: 2 * time.Second}).
			WithKeyResolver(func(ctx context.Context) (string, error) {
				return broker.KeyForTenantScoped(ctx, "", tenantID, []string{"observability:read"})
			})
		// breach-window over the smallest window. The endpoint deliberately does NOT 404 on an
		// unknown guard (that would confirm the id to another workspace), so ownership is read from
		// the explicit guardExists field rather than from a status code.
		raw, err := dc.MonitorBreachWindow(ctx, monitorID, 60)
		if err != nil {
			var us *thelens.UpstreamStatusError
			if errors.As(err, &us) && (us.Status == http.StatusNotFound || us.Status == http.StatusForbidden) {
				return routes.ErrMonitorNotOwned
			}
			return err
		}
		var w struct {
			MonitorExists bool `json:"guardExists"`
		}
		if err := json.Unmarshal(raw, &w); err != nil {
			return err
		}
		if !w.MonitorExists {
			return routes.ErrMonitorNotOwned
		}
		return nil
	}
}

// healthPinger converte o *sql.DB em routes.Pinger PRESERVANDO o nil.
//
// Sem isto, um `db` nil de tipo concreto vira uma interface NAO-nil: o handler tentaria pingar e
// devolveria 503 num deploy legitimo sem banco. E a armadilha classica de nil tipado em Go, e
// TestHealth_returns_200_when_no_database_is_configured e o par que a mantem fechada.
func healthPinger(db *sql.DB) routes.Pinger {
	if db == nil {
		return nil
	}
	return db
}
