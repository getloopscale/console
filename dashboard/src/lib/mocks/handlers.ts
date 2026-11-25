// Mock handlers for /api/v1/* endpoints — Plan v1.0 T0.4.
//
// Registers a handler for every endpoint listed in api/internal/server/router.go
// that has an end-user UI consumer. Admin/internal endpoints (admin/tenants/pin,
// internal/bootstrap, webhooks/github) intentionally omitted — no UI need.
//
// Pattern per handler:
//   1. Receives Request + extracted params.
//   2. Returns Response with status code + JSON body matching the Go API shape.
//   3. Errors use the canonical LoopScaleError envelope `{ code, message }`.
//   4. In-memory state mutates per-session (delete reflected in subsequent GET).
//
// Call `registerAllMockHandlers()` once at boot from main.tsx via installMocks.

import type {
  AuditListResponse,
  BillingResponse,
  Build,
  BuildAttestation,
  BuildListResponse,
  BuildSBOM,
  Environment,
  EnvironmentListResponse,
  Project,
  ProjectConnection,
  ProjectListResponse,
  ProjectStatusDetail,
  Secret,
  SecretListResponse,
  TeamListResponse,
  TeamMember,
  TenantDeleteResponse,
  Whoami,
} from '@/lib/api/types';
import {
  auditEntriesFixture,
  buildsFixture,
  environmentsFixture,
  makeProject,
  makeProjectConnection,
  makeProjectStatus,
  projectsFixture,
  secretsFixture,
  teamMembersFixture,
  buildLogLines,
} from './fixtures';
import { registerRoute } from './server';

import { registerTrustHandlers } from './trust-handlers';
import { registerLensHandlers } from './lens-handlers';
import { registerStreamHandlers } from './stream-handlers';
import { registerOverviewHandlers } from './overview-handlers';
import { registerSkillsDistributionHandlers, registerSkillsHandlers } from './skills-handlers';
import { registerPromptlyHandlers } from './promptly-handlers';
import { registerDomainHandlers, resetDomainMocks } from './domain-handlers';
import { registerPreviewHandlers, resetPreviewMocks } from './preview-handlers';

/**
 * Cursor da sequência de `/connect` (ver a rota lá embaixo, issue #378).
 *
 * Vive no módulo, logo o escopo é a CARGA DA PÁGINA — cada `goto` do teste começa do zero, que
 * é o que um cenário de polling precisa. Guardá-lo em `window` daria o mesmo escopo com mais
 * superfície pública; guardá-lo no `db` misturaria estado de teste com estado de domínio.
 */
let connectSequenceCursor = 0;

// ============================================================================
// In-memory "DB" — mutates per session to simulate CRUD persistence
// ============================================================================

const db = {
  projects: [...projectsFixture] as Project[],
  builds: [...buildsFixture] as Build[],
  secrets: [...secretsFixture] as Secret[],
  members: [...teamMembersFixture] as TeamMember[],
  environments: [...environmentsFixture] as Environment[],
};

function err(code: string, message: string, status: number): Response {
  return Response.json({ code, message }, { status });
}

// ============================================================================
// Auth (api/internal/routes/auth.go)
// ============================================================================

function registerAuthHandlers() {
  registerRoute('GET', '/api/v1/auth/whoami', async () => {
    const body: Whoami = {
      user_id: 'mock-user-uuid-0000-0000',
      email: 'demo@example.com',
      name: 'Demo Operator',
      team_id: 'team-acme',
      team_slug: 'acme',
      teams: [
        { id: 'team-acme', slug: 'acme', role: 'owner' },
        { id: 'team-personal', slug: 'personal', role: 'owner' },
      ],
    };
    return Response.json(body);
  });

  registerRoute('POST', '/api/v1/auth/team/switch', async (req) => {
    const body = (await req.json()) as { team_id?: string };
    if (!body.team_id) return err('INVALID_INPUT', 'team_id required', 400);
    return Response.json({ team_id: body.team_id, status: 'switched' });
  });
}

// ============================================================================
// Projects (api/internal/routes/projects.go)
// ============================================================================

const RESERVED_SLUGS = new Set([
  'new', 'edit', 'create', 'delete', 'settings', 'admin', 'api',
]);

function registerProjectHandlers() {
  registerRoute('GET', '/api/v1/projects', async () => {
    const body: ProjectListResponse = { projects: db.projects, total: db.projects.length };
    return Response.json(body);
  });

  registerRoute('GET', '/api/v1/projects/{name}', async (_req, { name }) => {
    const project = db.projects.find((p) => p.name === name);
    if (!project) return err('NOT_FOUND', `Project "${name}" not found`, 404);
    return Response.json(project);
  });

  registerRoute('POST', '/api/v1/projects', async (req) => {
    const body = (await req.json()) as { name?: string };
    if (!body.name) return err('INVALID_INPUT', 'name is required', 400);
    if (RESERVED_SLUGS.has(body.name)) {
      return err('RESERVED_SLUG', `"${body.name}" is a reserved slug`, 400);
    }
    if (db.projects.find((p) => p.name === body.name)) {
      return err('CONFLICT', `Project name "${body.name}" already taken`, 409);
    }
    const project = makeProject(body.name);
    db.projects.push(project);
    return Response.json(project, { status: 201 });
  });

  registerRoute('DELETE', '/api/v1/projects/{name}', async (_req, { name }) => {
    const i = db.projects.findIndex((p) => p.name === name);
    if (i < 0) return err('NOT_FOUND', `Project "${name}" not found`, 404);
    db.projects.splice(i, 1);
    return new Response(null, { status: 204 });
  });

  registerRoute(
    'DELETE',
    '/api/v1/projects/{name}/environments/{env}',
    async () => new Response(null, { status: 204 }),
  );

  // Project-scoped operations
  registerRoute('GET', '/api/v1/projects/{name}/status', async (_req, { name }) => {
    const status: ProjectStatusDetail = makeProjectStatus(name);
    return Response.json(status);
  });

  registerRoute('GET', '/api/v1/projects/{name}/builds', async (_req, { name }) => {
    const builds = db.builds.filter((b) => b.project_id === name);
    const body: BuildListResponse = { builds, total: builds.length };
    return Response.json(body);
  });

  registerRoute('POST', '/api/v1/projects/{name}/scale', async (req, { name }) => {
    const body = (await req.json()) as { replicas?: number; min?: number; max?: number };
    return Response.json({ project: name, applied: body });
  });

  registerRoute('POST', '/api/v1/projects/{name}/rollback', async (req) => {
    const body = (await req.json()) as { build_id?: string };
    if (!body.build_id) return err('INVALID_INPUT', 'build_id required', 400);
    return Response.json({ release_id: `rel-${Date.now()}`, status: 'queued' });
  });

  registerRoute('POST', '/api/v1/projects/{name}/promote', async (req) => {
    const body = (await req.json()) as { from_environment?: string; to_environment?: string };
    return Response.json({
      release_id: `rel-${Date.now()}`,
      status: 'queued',
      from: body.from_environment,
      to: body.to_environment,
    });
  });

  // GitHub repo connection
  //
  // ALAVANCA DE SEQUÊNCIA — `window.__LOOPSCALE_MOCK_CONNECT_SEQUENCE` (issue #378).
  //
  // Esta rota é servida EM PROCESSO pelo dublê, não pela rede. Consequência que custou caro:
  // um `page.route('**/projects/*/connect')` no Playwright **nunca dispara** aqui, e os
  // cenários do e2e que montavam uma sequência de respostas para exercitar a máquina de
  // estados do polling estavam, na prática, testando a resposta estática do fixture. Como o
  // arquivo é `mode: 'serial'` e o primeiro cenário falhava por outro motivo, eles ficaram
  // PULADOS — nunca executados — e ninguém percebeu.
  //
  // A alavanca segue o padrão que já existia para sessão (`__LOOPSCALE_MOCK_LOGGED_OUT`): o teste
  // planta a sequência com `addInitScript`, e cada GET consome a próxima. Esgotada, a última
  // se repete — para que o polling continue estável no estado final em vez de voltar ao
  // começo, que seria um comportamento que servidor nenhum tem.
  registerRoute('GET', '/api/v1/projects/{name}/connect', async (_req, { name }) => {
    const seq = (window as unknown as { __LOOPSCALE_MOCK_CONNECT_SEQUENCE?: ProjectConnection[] })
      .__LOOPSCALE_MOCK_CONNECT_SEQUENCE;
    if (Array.isArray(seq) && seq.length > 0) {
      const i = Math.min(connectSequenceCursor, seq.length - 1);
      connectSequenceCursor += 1;
      return Response.json(seq[i]!);
    }
    const conn: ProjectConnection = makeProjectConnection(name);
    return Response.json(conn);
  });

  // O CORPO CANÔNICO É `{ repo, installation_id, branch, auto_deploy }` — e este dublê exigia
  // `repo_url`, devolvendo 400 quando ele faltava. Como a tela envia `repo` (o slug
  // `owner/name`), CONECTAR REPOSITÓRIO FALHAVA SEMPRE em qualquer ambiente mockado: no
  // desenvolvimento visual e no e2e. Ninguém viu porque o único cenário que exercitava este
  // POST estava pulado (issue #378) — o defeito e o teste que o pegaria adoeceram juntos.
  //
  // `repo_url` era o nome ANTERIOR, declarado legado no próprio tipo. Saiu com o resto (#377).
  //
  // O corpo recebido fica em `window.__LOOPSCALE_MOCK_LAST_CONNECT_POST` para o e2e poder afirmar a
  // FORMA do pedido: esta rota é servida em processo, então `page.route` não a intercepta e não
  // há outro jeito de inspecionar o que a tela enviou.
  registerRoute('POST', '/api/v1/projects/{name}/connect', async (req, { name }) => {
    const body = (await req.json()) as {
      repo?: string;
      installation_id?: number;
      branch?: string;
      auto_deploy?: boolean;
    };
    (window as unknown as { __LOOPSCALE_MOCK_LAST_CONNECT_POST?: unknown }).__LOOPSCALE_MOCK_LAST_CONNECT_POST =
      body;
    if (!body.repo) return err('INVALID_INPUT', 'repo required', 400);
    return Response.json({
      connected: true,
      repo: body.repo,
      installation_id: body.installation_id,
      branch: body.branch ?? 'main',
      auto_deploy: body.auto_deploy ?? true,
      project: name,
    });
  });

  registerRoute('DELETE', '/api/v1/projects/{name}/connect', async () => {
    return Response.json({ connected: false });
  });
}

// ============================================================================
// Builds (api/internal/routes/builds.go)
// ============================================================================

function registerBuildHandlers() {
  // ORDEM IMPORTA: esta rota vem ANTES de `/api/v1/builds/{id}`. O matcher e
  // primeiro-que-casa (server.ts:97) e nao prefere segmento literal sobre
  // parametro — registrada depois, ela era engolida pelo `{id}`, que respondia
  // `Build "stats" not found` com 404. Medido no navegador antes de mover.
  // Serie diaria de deploys que alimenta o painel "DEPLOY ACTIVITY" do Overview.
  // Tambem nao tinha mock — era o terceiro endpoint da tela inicial a falhar em
  // dev, e o unico que sobrou depois de corrigir billing e status/versions.
  //
  // A serie e DENSA e com zeros no meio de proposito: o componente preenche
  // buracos server-side, e uma serie sem dia vazio nao exercitaria isso.
  registerRoute('GET', '/api/v1/builds/stats', async (req) => {
    const window = new URL(req.url).searchParams.get('window') ?? '7d';
    const days = window === '90d' ? 90 : window === '30d' ? 30 : 7;
    const contagens = [3, 0, 5, 2, 0, 8, 1];
    const by_day = Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.UTC(2026, 7, 7) - (days - 1 - i) * 86_400_000);
      return { date: d.toISOString().slice(0, 10), count: contagens[i % contagens.length] };
    });
    const total = by_day.reduce((s, d) => s + d.count, 0);
    return Response.json({
      window_days: days,
      timezone: 'UTC',
      by_day,
      last_7d_count: by_day.slice(-7).reduce((s, d) => s + d.count, 0),
      total_count: total,
    });
  });

  registerRoute('GET', '/api/v1/builds/{id}', async (_req, { id }) => {
    const build = db.builds.find((b) => b.build_id === id);
    if (!build) return err('NOT_FOUND', `Build "${id}" not found`, 404);
    return Response.json(build);
  });

  registerRoute('POST', '/api/v1/builds/{id}/cancel', async (_req, { id }) => {
    const build = db.builds.find((b) => b.build_id === id);
    if (!build) return err('NOT_FOUND', `Build "${id}" not found`, 404);
    if (build.status !== 'running' && build.status !== 'queued') {
      return err('INVALID_STATE', `Cannot cancel build in status "${build.status}"`, 409);
    }
    build.status = 'cancelled';
    build.finished_at = new Date().toISOString();
    return Response.json(build);
  });

  registerRoute('GET', '/api/v1/builds/{id}/sbom', async () => {
    // LIVE bug 2026-06-06: shape updated to match backend (metadata
    // per app + presigned download_url, not inline CycloneDX).
    const sbom: BuildSBOM = {
      build_id: 'b-mock',
      apps: [
        {
          app_name: 'api',
          sbom_format: 'cyclonedx-json',
          component_count: 949,
          generated_at: new Date().toISOString(),
          download_url: 'http://mock.local/sbom/api.cdx.json',
        },
      ],
    };
    return Response.json(sbom);
  });

  registerRoute('GET', '/api/v1/builds/{id}/attestation', async () => {
    const att: BuildAttestation = {
      build_id: 'b-mock',
      image_digest: 'sha256:abcdef0123456789',
      image_signature: 'mock-registry/teste/api:abc@sha256:abcdef',
      signed_at: new Date().toISOString(),
      signed: true,
    };
    return Response.json(att);
  });

  registerRoute('GET', '/api/v1/builds/{id}/logs', async () => {
    return Response.json({ lines: buildLogLines });
  });
}

// ============================================================================
// SSE log streams
// ============================================================================

function registerSecretHandlers() {
  registerRoute('GET', '/api/v1/secrets', async () => {
    const body: SecretListResponse = { secrets: db.secrets, total: db.secrets.length };
    return Response.json(body);
  });

  registerRoute('POST', '/api/v1/secrets', async (req) => {
    const body = (await req.json()) as { name?: string; environments?: string[] };
    if (!body.name) return err('INVALID_INPUT', 'name required', 400);
    if (db.secrets.find((s) => s.name === body.name)) {
      return err('CONFLICT', `Secret "${body.name}" already exists`, 409);
    }
    const secret: Secret = {
      name: body.name,
      environments: body.environments ?? ['production'],
      last_updated_by: 'demo@example.com',
      updated_at: new Date().toISOString(),
      eso_sync_status: 'pending',
    };
    db.secrets.push(secret);
    return Response.json(secret, { status: 201 });
  });

  registerRoute('DELETE', '/api/v1/secrets/{name}', async (_req, { name }) => {
    const i = db.secrets.findIndex((s) => s.name === name);
    if (i < 0) return err('NOT_FOUND', `Secret "${name}" not found`, 404);
    db.secrets.splice(i, 1);
    return new Response(null, { status: 204 });
  });
}

// ============================================================================
// Teams
// ============================================================================

function registerTeamHandlers() {
  registerRoute('GET', '/api/v1/teams/members', async () => {
    const body: TeamListResponse = { members: db.members };
    return Response.json(body);
  });

  registerRoute('POST', '/api/v1/teams/members', async (req) => {
    const body = (await req.json()) as { email?: string; role?: 'admin' | 'member' };
    if (!body.email) return err('INVALID_INPUT', 'email required', 400);
    if (db.members.find((m) => m.email === body.email)) {
      return err('CONFLICT', `Member "${body.email}" already exists`, 409);
    }
    const member: TeamMember = {
      email: body.email,
      role: body.role ?? 'member',
      joined: new Date().toISOString().slice(0, 10),
    };
    db.members.push(member);
    return Response.json(member, { status: 201 });
  });

  registerRoute('DELETE', '/api/v1/teams/members/{username}', async (_req, { username }) => {
    const i = db.members.findIndex((m) => m.username === username || m.email === username);
    if (i < 0) return err('NOT_FOUND', `Member "${username}" not found`, 404);
    if (db.members[i].role === 'owner') {
      return err('FORBIDDEN', 'Cannot remove owner', 403);
    }
    db.members.splice(i, 1);
    return new Response(null, { status: 204 });
  });

  registerRoute('PATCH', '/api/v1/teams/members/{username}', async (req, { username }) => {
    const body = (await req.json()) as { role?: 'admin' | 'member' };
    const member = db.members.find((m) => m.username === username || m.email === username);
    if (!member) return err('NOT_FOUND', `Member "${username}" not found`, 404);
    if (body.role) member.role = body.role;
    return Response.json(member);
  });
}

// ============================================================================
// Environments
// ============================================================================

function registerEnvironmentHandlers() {
  registerRoute('GET', '/api/v1/environments', async () => {
    const body: EnvironmentListResponse = {
      environments: db.environments,
      total: db.environments.length,
    };
    return Response.json(body);
  });

  registerRoute('GET', '/api/v1/environments/{name}', async (_req, { name }) => {
    const env = db.environments.find((e) => e.name === name);
    if (!env) return err('NOT_FOUND', `Environment "${name}" not found`, 404);
    return Response.json(env);
  });

  registerRoute('POST', '/api/v1/environments', async (req) => {
    const body = (await req.json()) as { name?: string; protected?: boolean };
    if (!body.name) return err('INVALID_INPUT', 'name required', 400);
    if (db.environments.find((e) => e.name === body.name)) {
      return err('CONFLICT', `Environment "${body.name}" already exists`, 409);
    }
    const env: Environment = {
      name: body.name,
      status: 'idle',
      projects: 0,
      protected: body.protected ?? false,
    };
    db.environments.push(env);
    return Response.json(env, { status: 201 });
  });

  registerRoute('DELETE', '/api/v1/environments/{name}', async (_req, { name }) => {
    const i = db.environments.findIndex((e) => e.name === name);
    if (i < 0) return err('NOT_FOUND', `Environment "${name}" not found`, 404);
    db.environments.splice(i, 1);
    return new Response(null, { status: 204 });
  });
}

// ============================================================================
// Domains
// ============================================================================


// ============================================================================
// Audit log
// ============================================================================

function registerAuditHandlers() {
  registerRoute('GET', '/api/v1/audit', async (req) => {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const actor = url.searchParams.get('actor');
    let entries = auditEntriesFixture;
    if (action) entries = entries.filter((e) => e.action.startsWith(action));
    if (actor) entries = entries.filter((e) => (e.actor ?? e.actor_email ?? '').includes(actor));
    const body: AuditListResponse = { entries, total: entries.length };
    return Response.json(body);
  });
}

// ============================================================================
// Billing
// ============================================================================

function registerBillingHandlers() {
  // CAMINHO CORRIGIDO em 2026-08-07: estas rotas estavam sob `/api/v1/`, que e o
  // prefixo do ENGINE. Billing e da API CLOUD, e o dashboard sempre chamou
  // `/v1/billing` (billing.tsx:94,143 e overview.tsx:57). O mock existia e nunca
  // casou com nada — em dev sem backend, as tres telas caiam num 500 do proxy.
  //
  // Verificado antes de mover: `grep -rn "api/v1/billing"` fora de mocks/ nao
  // retorna consumidor algum. Nao ha rota a preservar.
  registerRoute('GET', '/v1/billing', async () => {
    const body: BillingResponse = {
      plan: 'pro',
      team: 'acme',
      period_start: '2026-05-01T00:00:00Z',
      period_end: '2026-05-31T23:59:59Z',
      // CHAVES REAIS do billing.go (getLimitsForPlan / getUsageForTenant). As
      // anteriores — 'Fast Data Transfer', 'Edge Requests', 'Build Minutes' — eram
      // o vocabulario da MAQUETE, e `overview.tsx:84` diz isso com todas as
      // letras: "bind to the REAL /v1/billing.usage keys, NOT the Vercel-mockup
      // vocabulary that never populated".
      //
      // O mock descrevia uma API que o backend nao produz, entao as quatro barras
      // de uso do Overview caiam no fallback e mostravam 0/2, 0/100, 0/1, 0/1 —
      // numeros plausiveis, o que e pior que numeros obviamente errados.
      usage: {
        projects: { used: 4, limit: 10 },
        builds_per_month: { used: 145, limit: 1000 },
        environments: { used: 2, limit: 3 },
        seats: { used: 3, limit: 10 },
      },
      // Exercita o caminho POPULADO do card "Plan". Omitir era valido — o codigo
      // renderiza "—" honesto quando a API nao manda (enterprise / plano ainda
      // nao persistido) —, mas em dev so o caminho nulo era exercitado.
      plan_price: { amount_minor: 2000, currency: 'USD', interval: 'month' },
      plan_cap: {
        max_projects: 10,
        max_environments: 3,
        max_builds_per_month: 1000,
        max_replicas: 5,
        max_seats: 10,
      },
    };
    return Response.json(body);
  });

  registerRoute('POST', '/v1/billing/portal', async () => {
    return Response.json({ url: 'https://billing.stripe.com/p/mock_session' });
  });
}

// ============================================================================
// Tenants (account lifecycle)
// ============================================================================

function registerTenantHandlers() {
  registerRoute('DELETE', '/api/v1/tenants/{id}', async (_req, { id }) => {
    const body: TenantDeleteResponse = {
      tenant_id: id,
      status: 'PENDING_DELETION',
      grace_period_days: 30,
    };
    return Response.json(body);
  });

  registerRoute('POST', '/api/v1/tenants/{id}/restore', async (_req, { id }) => {
    return Response.json({ tenant_id: id, status: 'ACTIVE' });
  });
}

// ============================================================================
// Health / Version (no UI consumer but completeness)
// ============================================================================

function registerSystemHandlers() {
  // O relatorio de versoes que alimenta o ponto de status no rodape da barra
  // lateral. Era o unico endpoint da tela inicial sem mock — em dev sem backend
  // o rodape mostrava "Status unavailable", que e honesto mas inutil.
  //
  // Os dados exercitam a AGREGACAO de proposito, em vez de pintar tudo de verde:
  // ha um servico `ok`, um `not_deployed` e um `unreachable`. Por ADR D9 a
  // agregacao e por ALLOWLIST — verde exige prova —, entao esta combinacao
  // resulta em `degraded`, e quem desenvolve ve o estado intermediario em vez de
  // um verde que nao testa nada.
  registerRoute('GET', '/v1/dashboard/status/versions', async () =>
    Response.json({
      collected_at: '2026-08-07T12:00:00Z',
      services: [
        {
          name: 'theo-engine',
          state: 'ok',
          checked_at: '2026-08-07T12:00:00Z',
          version: 'v0.85.0',
          built_at: '2026-08-05T18:00:00Z',
        },
        { name: 'theo-storage', state: 'not_deployed', checked_at: '2026-08-07T12:00:00Z' },
        {
          name: 'theo-lens',
          state: 'unreachable',
          checked_at: '2026-08-07T12:00:00Z',
          reason: 'dial tcp: connection refused (mock)',
        },
      ],
    }),
  );

  registerRoute('GET', '/api/v1/health', async () => Response.json({ ok: true }));
  registerRoute('GET', '/api/v1/health/deep', async () =>
    Response.json({ ok: true, postgres: 'ok', argocd: 'ok' }),
  );
  registerRoute('GET', '/api/v1/version', async () =>
    Response.json({ version: 'mock-1.0.0', commit: 'abc123', build_date: '2026-05-26' }),
  );
}

// ============================================================================
// Public install
// ============================================================================

let installed = false;

/** Register every mock handler. Idempotent — safe to call multiple times. */
export function registerAllMockHandlers(): void {
  if (installed) return;
  installed = true;
  registerAuthHandlers();
  registerProjectHandlers();
  registerBuildHandlers();
  registerStreamHandlers();
  registerSecretHandlers();
  registerTeamHandlers();
  registerEnvironmentHandlers();
  registerDomainHandlers();
  registerPreviewHandlers();
  registerAuditHandlers();
  registerBillingHandlers();
  registerTenantHandlers();
  registerSystemHandlers();
  registerTrustHandlers();
  // M26 — sem este registro a jornada do registro de skills não entra no e2e hermético.
  registerSkillsHandlers();
  registerSkillsDistributionHandlers();
  // M25 — idem para a jornada de prompts (catálogo → detalhe → promoção).
  registerPromptlyHandlers();
  // M142 — sem este registro a tela de consumo por end-user sobe VAZIA no e2e, e um portão que
  // só afirma heading fica verde nela.
  registerLensHandlers();
  // B-112 — os quatro agregados de capacidade que nenhum mock servia. Sem eles, metade dos cards
  // da Overview de plataforma diz "couldn't load" no unico ambiente onde alguem valida telas.
  registerOverviewHandlers();
}

/** Test-only: reset the in-memory DB to initial fixture state. */
export function resetMockDB(): void {
  db.projects = [...projectsFixture];
  db.builds = [...buildsFixture];
  db.secrets = [...secretsFixture];
  db.members = [...teamMembersFixture];
  db.environments = [...environmentsFixture];
  resetDomainMocks();
  resetPreviewMocks();
  installed = false;
}
