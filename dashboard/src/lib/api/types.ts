// TypeScript types mirroring Go API structs from `api/internal/routes/*.go`.
//
// Plan v1.0 T0.1 — single source of truth for API shapes. Each interface
// includes JSDoc pointing to the source Go file so drift is visible in code
// review (compare json:"tag" against TS field name).
//
// Conventions:
//   - Go `string`           → TS `string`
//   - Go `int`              → TS `number`
//   - Go `*int` / `*string` → TS `number | null` / `string | null`
//   - Go `omitempty`        → TS `field?: T` (optional)
//   - Go timestamps         → TS `string` (ISO 8601 RFC3339)
//   - Go `json.RawMessage`  → TS `unknown`
//
// When adding a new interface, also update lib/mocks/handlers/{domain}.ts to
// register a handler returning a fixture of this shape.

// ============================================================================
// Common error shape (used across all routes)
// ============================================================================

/** Canonical TheoError envelope.
 * @see api/internal/routes/audit.go:jsonError + pkg/errors/http */
export interface TheoError {
  code: string;
  message: string;
}

// ============================================================================
// Auth / Whoami
// ============================================================================

/** @see api/internal/routes/auth.go:Whoami response */
export interface Whoami {
  user_id: string;
  email: string;
  name?: string;
  team_id: string;
  team_slug: string;
  teams?: WhoamiTeam[];
}

export interface WhoamiTeam {
  id: string;
  slug: string;
  role: string;
}

export interface TeamSwitchInput {
  team_id: string;
}

// ============================================================================
// Projects (api/internal/routes/projects.go)
// ============================================================================

/** Single app within a project (server/worker/frontend).
 * @see api/internal/routes/projects.go:AppInput */
export interface App {
  name: string;
  type?: string;             // "server" | "worker" | "frontend"
  port?: number;
  path?: string;
  framework?: string;        // "express" | "go" | "fastapi" | etc.
  build?: string;            // "dockerfile" | "buildpack" | "custom"
  rendering?: string;        // "static" | "server" (Sprint 10)
  secrets?: string[];
  replicas?: number;
  status?: string;           // populated by status aggregator
}

export interface Project {
  name: string;
  apps?: App[];
  last_deploy?: string | null;     // ISO timestamp; null if never deployed
  last_deploy_status?: ProjectStatus;
  environment?: string;            // legacy singular (pre-M2); kept for backward compat
  // T2.1 + ADR D2 (plan 2026-06-08-dashboard-screens-review-fixes):
  // per-project total env count, derived server-side via LEFT JOIN
  // LATERAL on environment_targets. The dashboard /projects table
  // renders this as "Live envs" instead of the legacy singular
  // `environment` field.
  environment_count?: number;
  // Red Team theo-cloud#41 absorption (2026-06-27): subset of
  // environment_count that includes ONLY env_targets with kind='permanent'
  // (production-like envs). The dashboard's "Live envs" column / hero
  // metric MUST use this — `environment_count` collapses preview
  // env_targets too, producing the misleading "Live envs: 1 + URL pending"
  // pair the Red Team caught.
  production_env_count?: number;
  // Red Team theo-cloud#134 absorption (2026-07-02): count of env_targets
  // that currently have a corresponding release with status='ACTIVE'
  // (preview OR permanent kind). The dashboard "LIVE ENVS" counter
  // MUST use this — `production_env_count` returns 0 for preview-only
  // projects, contradicting the Live URL exposed on the SAME page when
  // a preview env is serving.
  //
  // Semantic distinction (all three coexist on the same wire response):
  //   - environment_count    — all env_targets (any kind, any release)
  //   - production_env_count — kind='permanent' subset (any release)
  //   - active_env_count     — any kind WITH active release ("live")
  //
  // The `isPreviewOnly` heuristic keeps using `production_env_count`
  // because it asks a different question ("was any permanent env
  // provisioned?" — semantic of "wired for production, not just preview").
  active_env_count?: number;
  // T2.1 additive completion (T5.3 LIVE-bug fix 2026-06-08): backend
  // now populates these via the latest_build LATERAL join so the
  // /projects table no longer shows "—" / 0 in Apps + Framework
  // columns after the legacy apps[] array was dropped. T4.4 of plan
  // 2026-06-11-code-review-remediation v1.2 — formalized in the type
  // contract so future refactors keep the frontend↔backend shape in
  // sync (eliminates the silent drift that caused the 2026-06-08
  // LIVE catch).
  latest_framework?: string;
  apps_count?: number;
  // Red Team theo-cloud#41 (2026-06-27): the latest build's environment
  // ("preview" / "production" / "staging" / ...). Drives the
  // preview-only-project disambiguation in projects.tsx / LiveUrlHero
  // so a preview-only project does NOT render "Live" + "URL PENDING".
  latest_build_environment?: string;
  created_at?: string;
  // Data-plane snapshot fields — T4.1 of plan
  // dashboard-badge-data-plane-poller closing Red Team theo-cloud#128
  // (badge lies "Live" when control-plane ACTIVE + data-plane 502).
  // Populated by the DataPlanePoller Runnable in theo-app-operator via
  // migration 000045 columns; ABSENT (both fields undefined) when the
  // Cleanroom is warming up before the first poller tick OR the operator
  // env-gate is off. The dashboard's 4-state badge derivation
  // (`ProjectRow`) maps absence to the honest "Unknown" state — no signal
  // is NOT collapsed to "Live" or "Down".
  //
  // last_replicas_ready_value = kube_deployment_status_replicas_ready
  // scraped from Prometheus and persisted to environment_targets. 0 with
  // a fresh timestamp is the release-active-but-data-plane-DOWN signal
  // (Red Team #128 closure).
  //
  // last_replicas_ready_at = ISO8601 timestamp of the scrape. Staleness
  // beyond the derivation thresholds degrades to "Unknown" rather than
  // asserting a stale Live/Down verdict (EC-7 no-flicker headroom).
  last_replicas_ready_value?: number;
  last_replicas_ready_at?: string;
}

// Red Team theo-cloud#41 absorption (2026-06-27): 'preview' value
// indicates a project whose only deploys are preview-environment builds
// (no active production release). The dashboard renders a distinct
// "Preview" badge — never "Live" with a contradictory "URL PENDING"
// hint. Backend mapper is `pkg/enforcement.MapProjectStatus`.
export type ProjectStatus = 'live' | 'building' | 'failed' | 'idle' | 'queued' | 'preview';

export interface ProjectListResponse {
  projects: Project[];
  total?: number;
}

export interface ProjectCreateInput {
  name: string;
  apps?: App[];
  environment?: string;
}

// ============================================================================
// Builds (api/internal/routes/builds.go + build_list.go)
// ============================================================================

/** @see api/internal/routes/builds.go:BuildResponse */
export interface Build {
  build_id: string;
  project_id: string;
  environment: string;
  status: BuildStatus;
  commit_sha: string;
  created_by: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  duration_seconds?: number | null;
  error?: string;
  apps?: BuildApp[];
  manifests?: string;
}

export type BuildStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'cancelling';

/**
 * Normalize a build status string returned by the API to the lowercase
 * BuildStatus union the UI expects.
 *
 * LIVE bug caught 2026-06-06 J-17 dogfood: the backend stores statuses
 * in CAPS ('QUEUED', 'RUNNING', 'RELEASING', 'SUCCEEDED', 'FAILED',
 * 'CANCELLING', 'CANCELLED') and surfaces them as-is in the JSON
 * responses. The TS type declared lowercase. Looking up
 * STATUS_MAP['RUNNING'] then returned undefined and propagated to
 * StatusDot which logged: `<StatusDot status="undefined" />`.
 *
 * Intermediate phases ('RELEASING') collapse to 'running' because the
 * UI does not have a separate visual treatment for "build done,
 * release activating" — both are "in flight".
 */
export function normalizeBuildStatus(s: string | undefined | null): BuildStatus {
  if (!s) return 'queued';
  const lower = s.toLowerCase();
  if (lower === 'releasing') return 'running';
  switch (lower) {
    case 'queued':
    case 'running':
    case 'succeeded':
    case 'failed':
    case 'cancelled':
    case 'cancelling':
      return lower;
    default:
      return 'queued';
  }
}

/** @see api/internal/routes/builds.go:BuildAppInfo / BuildCallbackApp */
export interface BuildApp {
  name: string;
  image_digest: string;
  url?: string;
  type?: string;
  duration_ms?: number;
}

export interface BuildListResponse {
  builds: Build[];
  total: number;
}

export interface BuildCreateInput {
  project_id: string;
  environment: string;
  commit_sha: string;
}

export interface BuildCreateResponse {
  build_id: string;
  stream_url: string;
}

// ============================================================================
// Build artifacts (SBOM + Attestation)
// ============================================================================

/** SBOM metadata response.
 * LIVE bug 2026-06-06: prior TS shape declared inline CycloneDX
 * payload. Backend (api/internal/routes/build_sbom.go) actually
 * returns metadata per app + presigned MinIO download_url. The full
 * CycloneDX JSON lives at download_url, not inline.
 * @see api/internal/routes/build_sbom.go:BuildSBOMResponse */
export interface BuildSBOM {
  build_id: string;
  apps: AppSBOMSummary[];
}

export interface AppSBOMSummary {
  app_name: string;
  sbom_format?: string;       // "cyclonedx-json"
  component_count?: number;
  generated_at?: string;      // ISO 8601
  download_url?: string;      // presigned MinIO URL (~1h TTL)
}

/** Attestation metadata.
 * LIVE bug 2026-06-06: prior TS shape declared a cosign envelope with
 * payloadType + base64 payload + signatures[]. Backend (domain.AttestationInfo)
 * actually returns a flat metadata record: digest, signature ref, signed flag,
 * signed_at. The dashboard renders the digest + signed badge; the raw cosign
 * envelope is not exposed via the BFF.
 * @see api/internal/domain/attestation.go:AttestationInfo */
export interface BuildAttestation {
  build_id: string;
  image_digest?: string;
  image_signature?: string;
  signed_at?: string;     // ISO 8601
  signed: boolean;
}

// ============================================================================
// Logs (api/internal/routes/logs.go + logs_stream.go)
// ============================================================================

/** Single log line. SSE stream emits one of these per `message` event. */
export interface LogLine {
  ts: string;             // ISO timestamp
  level: LogLevel;
  msg: string;
  source?: string;        // "stdout" | "stderr" | pod name
  correlation_id?: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** SSE event wrapper. The data field is a serialized LogLine. */
export interface LogStreamEvent {
  type: 'message' | 'heartbeat' | 'error' | 'close';
  data?: string;
  id?: string;
}

// ============================================================================
// Environments (api/internal/routes/environments.go)
// ============================================================================

export interface Environment {
  name: string;
  status?: string;
  // M2 v1.2 (2026-06-07): per-(project, env) tuple. Empty string =
  // legacy production entry (ADR D2 backward compat).
  project?: string;
  // Legacy counter — kept for backward compat with v1.0 dashboard
  // surfaces that displayed an aggregate project count per env.
  projects?: number;
  protected?: boolean;
  domain?: string;
  created_at?: string;
  // J-10 v1.1 LIVE KPI fields propagated from backend.
  last_deploy?: string;
  last_deploy_sha?: string;
}

export interface EnvironmentListResponse {
  environments: Environment[];
  total?: number;
}

export interface EnvironmentCreateInput {
  name: string;
  // M2 v1.2 T4.1: project is REQUIRED on POST /api/v1/environments.
  // Missing → backend returns 400 MISSING_FIELD.
  project: string;
  protected?: boolean;
}

// ============================================================================
// Domains (api/internal/routes/domains.go + domains_create.go + domains_dns.go)
// ============================================================================

export interface Domain {
  id: string;
  domain: string;
  project: string;
  app: string;
  environment: string;
  status: DomainStatus;
  tls?: DomainTLS;
  verification?: DomainVerification;
  cname_target: string;
  created_at: string;
  verified_at?: string;
}

export type DomainStatus =
  | 'pending_verification'
  | 'verified'
  | 'provisioning'
  | 'active'
  | 'failed'
  | 'removing';

export interface DomainTLS {
  status: 'pending' | 'issued' | 'expired' | 'renewing';
  expires_at?: string;
}

export interface DomainVerification {
  txt_name: string;
  txt_value: string;
}

export interface DomainListResponse {
  domains: Domain[];
  total: number;
}

export interface DomainCreateInput {
  domain: string;
  project: string;
  app: string;
  environment: string;
}

// ============================================================================
// Secrets (api/internal/routes/secrets.go)
// ============================================================================

/** Secret metadata (value never returned in list responses). */
export interface Secret {
  name: string;
  environments: string[];     // scoped to N envs
  last_updated_by?: string;
  updated_at?: string;
  eso_sync_status?: 'synced' | 'pending' | 'failed';
}

export interface SecretListResponse {
  secrets: Secret[];
  total: number;
}

export interface SecretSetInput {
  name: string;
  value: string;
  environments?: string[];
}

// ============================================================================
// Teams (api/internal/routes/teams.go)
// ============================================================================

export interface TeamMember {
  username?: string;
  name?: string;
  email: string;
  role: TeamRole;
  joined?: string;
}

export type TeamRole = 'owner' | 'admin' | 'member';

export interface TeamListResponse {
  members: TeamMember[];
}

export interface TeamMemberInput {
  email: string;
  role: TeamRole;
}

export interface TeamMemberRoleUpdate {
  role: TeamRole;
}

// ============================================================================
// Previews (api/internal/routes/preview.go)
// ============================================================================

export interface Preview {
  id: string;
  project: string;
  branch: string;
  pr_title?: string;
  pr_number?: number;
  pr_url?: string;
  url: string;                 // deployed preview URL
  status: PreviewStatus;
  created_by: string;
  created_at: string;
  expires_at: string;          // TTL deadline
}

export type PreviewStatus = 'creating' | 'active' | 'expiring' | 'failed' | 'deleting' | 'deleted';

export interface PreviewListResponse {
  previews: Preview[];
  total: number;
}

export interface PreviewCreateInput {
  branch: string;
  commit_sha: string;
}

// ============================================================================
// Status / Scale / Rollback / Promote (project-scoped operations)
// ============================================================================

/** @see api/internal/routes/status.go */
export interface ProjectStatusDetail {
  project: string;
  environment: string;
  // The fields below are populated only when the project has at least
  // one release in the requested environment. For a fresh project with
  // last_build=null and active_release=null the backend OMITS them
  // (Go zero-value -> JSON omitempty), so callers MUST treat them as
  // optional. ProjectHealthCard renders "-" when missing.
  replicas_ready?: number;
  replicas_desired?: number;
  deploy_status?: BuildStatus;
  build_status?: BuildStatus;
  traffic_5xx_pct_1h?: number;
  traffic_5xx_pct_24h?: number;
  alerts_active?: number;
  last_deploy_at?: string;
  // Plan J-17 LIVE bug 2026-06-06: backend returns nested last_build +
  // active_release objects; TS shape was missing them. Used by
  // DeploymentsPage to highlight which build is currently serving prod.
  last_build?: {
    id: string;
    status: BuildStatus | string;
    commit_sha: string;
    created_at: string;
    finished_at?: string;
    duration_seconds?: number;
    error?: string;
  };
  active_release?: {
    id: string;
    build_id: string;
    status: string;
    git_commit?: string;
    created_at: string;
  };
  sync_status?: string;
  url?: string;
  // Red Team theo-cloud#70/#62/#98 closure: when the queried env has no
  // last_build and no active_release, the engine lists sibling environments
  // (≠ queried) that DO have a SUCCEEDED build under this field. The
  // dashboard uses it to render an honest "No production deployment yet —
  // preview has a release" hint instead of a misleading 'Progressing'
  // empty-state. Optional (omitempty on the wire); zero-length / missing
  // means no siblings qualify.
  other_envs_with_releases?: Array<{ environment: string; has_release: boolean }>;
  // T1.1 of plan 2026-06-06-dashboard-journey-j18-status-runtime-health v1.1:
  // backend statusResponse adds Grafana deep-link templated URL + canonical
  // prom_query_keys list. metrics_range_url is empty string when operator did
  // not set THEO_GRAFANA_BASE_URL (honest disabled per ADR D2). prom_query_keys
  // is the deterministic 8-name list consumers use for /metrics queries.
  metrics_range_url?: string;
  prom_query_keys?: string[];
  // Scaling info from build app spec — present when last build had scaling
  // declared. Used by J-18 KPIStripStatus to render the Replicas card.
  scaling?: {
    replicas: number;
    min: number;
    max: number;
    scaled_to_zero: boolean;
  };
  // Resolved canonical plan tier for the project's tenant — `starter` /
  // `pro` / `team` / `enterprise` (mirrors pkg/domain.PlanTier). Engine
  // sources via PlanTierStore.GetTenantPlan (same store ScaleHandler uses
  // to enforce). Closes #123 of qa-dogfood-cleanup-2026-06-21 canonically
  // (the prior /v1/billing seed depended on Known Gap #116 cloud BFF
  // billing read-side, which is 404). Read by project-scale to seed the
  // slider ceiling pre-Apply. Optional — older engines omit it; callers
  // fall back to 'starter'. #142 of qa-dogfood-cleanup-2026-06-21.
  plan_tier?: string;
}

// J-20 Scale plan v1.1 — wire shape mirrors api/internal/routes/scale.go
// scaleRequest. The handler enforces mutual exclusion between `replicas`
// (fixed) and `min`/`max`/`cpu`/`memory` (autoscaling) per ADR D2.
export interface ScaleInput {
  app: string;
  environment?: string; // defaults to "production" server-side
  replicas?: number;
  min?: number;
  max?: number;
  cpu?: number; // HPA cpu_target [10, 95]
  memory?: number; // HPA memory_target [10, 90]
}

export interface ScaleAutoscaling {
  min: number;
  max: number;
  cpu_target: number;
  memory_target: number;
  cooldown?: number; // present when scale-to-zero (min=0)
}

// J-20 Scale plan v1.1 — wire shape mirrors api/internal/routes/scale.go
// scaleResponse. `monthly_cost_usd` is the server-authoritative cost
// (replicas * podCostPerHour * 730); the dashboard preview MUST
// reconcile to this value, not its local estimate (EC-2 absorption).
// `plan_tier` echoes the tenant's resolved tier for upgrade-CTA gating.
export interface ScaleResponse {
  app: string;
  environment: string;
  replicas?: number;
  autoscaling?: ScaleAutoscaling;
  status: 'acknowledged' | 'applied' | 'no_change';
  monthly_cost_usd: number;
  plan_tier: string;
}

export interface RollbackInput {
  build_id: string;
}

export interface RollbackResponse {
  release_id: string;
  status: BuildStatus;
}

export interface PromoteInput {
  from_environment: string;
  to_environment: string;
}

export interface PromoteResponse {
  release_id: string;
  status: BuildStatus;
}

// ============================================================================
// GitHub repo connect (api/internal/routes/repositories.go)
// ============================================================================

export interface ProjectConnection {
  connected: boolean;
  // O serviço devolve `repo` — o slug `owner/name`. O campo `repo_url`, declarado LEGADO
  // "durante a janela de migração", foi REMOVIDO (issue #377): a janela fechou, e um campo
  // legado que ninguém escreve é um caminho que o leitor acredita existir.
  repo?: string;
  branch?: string;
  auto_deploy?: boolean;
  installation_id?: number;
  provider?: string;
  connected_at?: string;
}

// Plan J-09 T3.1 (2026-06-05) — canonical POST payload matches backend
// connectRequest (api/internal/routes/repositories.go:60):
//   { repo: "owner/name", installation_id: number, branch?: string, auto_deploy?: boolean }
// Replaces the legacy { repo_url, branch, auto_deploy } shape which never
// worked end-to-end (recon confirmed HTTP 400).
export interface ProjectConnectInput {
  repo: string;
  installation_id: number;
  branch: string;
  auto_deploy: boolean;
}

// Plan J-09 T2.1 (2026-06-05) — sanitised repository from the engine
// /api/v1/integrations/github/installations/{id}/repositories endpoint.
// Field set MUST match engine.routes.InstallationRepository exactly --
// anything else would round-trip via JSON.parse but never get used.
export interface InstallationRepository {
  full_name: string;
  default_branch: string;
  private: boolean;
  language?: string;
}

// Wrapper envelope the engine returns (matches map[string]any{"repositories": ...}).
export interface InstallationRepositoriesResponse {
  repositories: InstallationRepository[];
}

// ============================================================================
// Billing (api/internal/routes/billing.go)
// ============================================================================

export interface BillingResponse {
  plan: string;
  team: string;
  usage: Record<string, BillingUsageMetric>;
  period_start?: string;
  period_end?: string;
  plan_cap?: BillingPlanCap;
}

export interface BillingUsageMetric {
  used: number;
  limit: number | null;       // null = unlimited (Enterprise)
}

export interface BillingPlanCap {
  max_projects: number | null;
  max_environments: number | null;
  max_builds_per_month: number | null;
  max_replicas: number | null;
  max_seats: number | null;
}

export interface BillingPortalResponse {
  url: string;                // Stripe customer portal URL
}

// ============================================================================
// Audit log (api/internal/routes/audit.go)
// ============================================================================

export interface AuditEntry {
  // Wire shape per api/internal/domain/types.go AuditEntryResult.
  // Legacy aliases (`ts`, `actor_email`, `actor_kind`, `id`,
  // `severity`) remain optional for forward-compat with backends that
  // emit them, but consumers MUST read the canonical fields below
  // first per QA Run-3 #126.
  action: string;
  resource_type?: string;
  resource_id?: string;
  actor: string;              // canonical (email OR system identifier)
  timestamp: string;          // canonical (ISO from CreatedAt)
  correlation_id?: string;
  metadata?: Record<string, unknown>;

  // Legacy aliases — backend MAY add these later for richer UX.
  id?: string;
  ts?: string;
  actor_email?: string;
  actor_kind?: AuditActorKind;
  severity?: AuditSeverity;
}

export type AuditActorKind = 'user' | 'system' | 'admin' | 'api';
export type AuditSeverity = 'info' | 'warning' | 'critical';

export interface AuditListResponse {
  entries: AuditEntry[];
  total: number;
  next_page_token?: string;
}

// ============================================================================
// Tenant lifecycle (api/internal/routes/tenants.go)
// ============================================================================

export interface TenantDeleteResponse {
  tenant_id: string;
  status: 'PENDING_DELETION' | 'DELETING' | 'DELETED';
  grace_period_days?: number;
}

export interface TenantRestoreResponse {
  tenant_id: string;
  status: 'ACTIVE';
}

// ============================================================================
// Pagination (api/internal/routes/pagination.go — shared envelope)
// ============================================================================

export interface PaginationParams {
  page?: number;
  page_size?: number;
  cursor?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page?: number;
  page_size?: number;
  next_page_token?: string;
}

// J-13 (MEET-2026-07-03-004) — a Stripe invoice as re-shaped by the BFF.
// Money is integer minor units + currency; timestamps are ISO-8601 UTC.
// invoice_pdf is intentionally absent (D3 security veto — capability-URL PII).
export interface Invoice {
  id: string;
  number: string;
  amount_minor: number;
  currency: string;
  status: string;
  created: string;
  period_start: string;
  period_end: string;
  hosted_invoice_url: string;
}

// ---------------------------------------------------------------------------
// Sessao Kratos.
//
// Estes tres tipos moravam em `src/lib/auth.ts`. Foram movidos para ca porque
// `dev-mocks.ts` precisa do `Session` e `auth.ts` precisa das funcoes de
// `dev-mocks` — o import de tipo de volta fechava o ciclo
// `api.ts -> dev-mocks.ts -> auth.ts` que o madge reportava (B-039).
//
// Este modulo e a ACL de tipos do backend e nao importa nada, entao e o unico
// destino que nao pode reintroduzir o ciclo. `auth.ts` re-exporta os tres, de
// modo que `@/lib/auth` continua sendo a superficie publica para os ~10
// consumidores existentes.
// ---------------------------------------------------------------------------

export interface VerifiableAddress {
  value: string;
  verified: boolean;
  via: string;
}

export interface AuthenticationMethod {
  method: string;
  provider?: string;
  completed_at?: string;
}

export interface Session {
  active: boolean;
  identity: {
    id: string;
    traits: {
      email: string;
      name?: string;
    };
    verifiable_addresses?: VerifiableAddress[];
  };
  authentication_methods?: AuthenticationMethod[];
}
