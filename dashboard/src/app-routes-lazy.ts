import { lazy } from 'react';

/**
 * As 83 páginas carregadas sob demanda.
 *
 * ## Por que este arquivo existe (B-003)
 *
 * `app.tsx` tinha 779 linhas: 85 declarações `lazy()` e 119 `<Route>` no mesmo
 * lugar. As duas metades mudam por razões diferentes — acrescentar uma tela é
 * uma linha aqui; mudar aninhamento, guarda ou redirect é trabalho no
 * roteamento. Junta-las fazia toda mudança de rota passar por 335 linhas de
 * declaração que ninguém precisava ler.
 *
 * ## O que NÃO veio junto, e por quê
 *
 * `PreviewsRedirect`, `RepositoryAlias` e `RouteScope` ficaram em `app.tsx`.
 * As duas primeiras são redirects de link legado — decisões de roteamento, não
 * declarações de página. `RouteScope` é um conserto de comportamento (limpa o
 * scroll-lock que o Radix deixa preso no `<body>` quando um overlay desmonta
 * durante a navegação, radix-ui/primitives#2122); ele pertence à árvore que
 * envolve, não a uma lista.
 *
 * Mover os três teria produzido um arquivo "coisas que estavam no app.tsx", que
 * é o balde genérico que o ADR-0001 existe para impedir.
 *
 * ## A ordem importa menos do que parece
 *
 * São declarações independentes; `lazy()` não avalia o import até o render. A
 * ordem preservada aqui é a do arquivo original — mudá-la não muda
 * comportamento, mas o diff de uma reordenação esconderia uma remoção.
 */

export const OverviewPage = lazy(() =>
  import('@/pages/overview/overview').then((m) => ({ default: m.OverviewPage })),
);
export const ProjectsPage = lazy(() =>
  import('@/pages/projects/projects').then((m) => ({ default: m.ProjectsPage })),
);
export const EnvironmentsPage = lazy(() =>
  import('@/pages/infra/environments').then((m) => ({ default: m.EnvironmentsPage })),
);
export const TeamPage = lazy(() =>
  import('@/pages/settings/team').then((m) => ({ default: m.TeamPage })),
);
export const BillingPage = lazy(() =>
  import('@/pages/settings/billing').then((m) => ({ default: m.BillingPage })),
);
// M21 — the detail behind the sidebar health indicator.
export const StatusPage = lazy(() =>
  import('@/pages/overview/status').then((m) => ({ default: m.StatusPage })),
);
export const SettingsPage = lazy(() =>
  import('@/pages/settings/overview').then((m) => ({ default: m.SettingsPage })),
);
export const ProfilePage = lazy(() =>
  import('@/pages/settings/profile').then((m) => ({ default: m.ProfilePage })),
);
export const DomainsPage = lazy(() =>
  import('@/pages/infra/domains').then((m) => ({ default: m.DomainsPage })),
);
export const ApiKeysPage = lazy(() =>
  import('@/pages/settings/api-keys').then((m) => ({ default: m.ApiKeysPage })),
);
export const MemoryPage = lazy(() =>
  import('@/pages/memory/overview').then((m) => ({ default: m.MemoryPage })),
);
export const MemoryListPage = lazy(() =>
  import('@/pages/memory/memories').then((m) => ({ default: m.MemoryListPage })),
);
export const EntitiesPage = lazy(() =>
  import('@/pages/memory/entities').then((m) => ({ default: m.EntitiesPage })),
);
export const EpisodesPage = lazy(() =>
  import('@/pages/memory/episodes').then((m) => ({ default: m.EpisodesPage })),
);
export const GraphPage = lazy(() =>
  import('@/pages/memory/graph').then((m) => ({ default: m.GraphPage })),
);
export const ExportsPage = lazy(() =>
  import('@/pages/memory/exports').then((m) => ({ default: m.ExportsPage })),
);
export const WebhooksPage = lazy(() =>
  import('@/pages/memory/webhooks').then((m) => ({ default: m.WebhooksPage })),
);
export const WorkspaceWebhooksPage = lazy(() =>
  import('@/pages/settings/webhooks').then((m) => ({ default: m.WorkspaceWebhooksPage })),
);
export const PlaygroundPage = lazy(() =>
  import('@/pages/memory/playground').then((m) => ({ default: m.PlaygroundPage })),
);
export const SkillsPage = lazy(() =>
  import('@/pages/memory/skills').then((m) => ({ default: m.SkillsPage })),
);
export const RagOverviewPage = lazy(() =>
  import('@/pages/rag/overview').then((m) => ({ default: m.RagOverviewPage })),
);
export const WorkspacePage = lazy(() =>
  import('@/pages/workspace/overview').then((m) => ({ default: m.WorkspacePage })),
);
export const RagCollectionsPage = lazy(() =>
  import('@/pages/rag/collections').then((m) => ({ default: m.RagCollectionsPage })),
);
export const RagConnectorsPage = lazy(() =>
  import('@/pages/rag/connectors').then((m) => ({ default: m.RagConnectorsPage })),
);
export const RagDocumentsPage = lazy(() =>
  import('@/pages/rag/documents').then((m) => ({ default: m.RagDocumentsPage })),
);
export const RagAskPage = lazy(() =>
  import('@/pages/rag/ask').then((m) => ({ default: m.RagAskPage })),
);
export const RagAnalyticsPage = lazy(() =>
  import('@/pages/rag/analytics').then((m) => ({ default: m.RagAnalyticsPage })),
);
export const RagGraphRagPage = lazy(() =>
  import('@/pages/rag/graphrag').then((m) => ({ default: m.RagGraphRagPage })),
);
export const RagWikiPage = lazy(() =>
  import('@/pages/rag/wiki').then((m) => ({ default: m.RagWikiPage })),
);
// M23 — a capacidade trust chega ao dashboard (visão geral + violações).
export const TrustOverviewPage = lazy(() =>
  import('@/pages/trust/overview').then((m) => ({ default: m.TrustOverviewPage })),
);
export const TrustViolationsPage = lazy(() =>
  import('@/pages/trust/violations').then((m) => ({ default: m.TrustViolationsPage })),
);
// M24 — operar guardrails: catálogo, criação com dry-run obrigatório e auditoria do enforcement.
export const TrustGuardrailsPage = lazy(() =>
  import('@/pages/trust/guardrails').then((m) => ({ default: m.TrustGuardrailsPage })),
);
export const TrustGuardrailNewPage = lazy(() =>
  import('@/pages/trust/guardrail-new').then((m) => ({ default: m.TrustGuardrailNewPage })),
);
export const TrustEnforcementPage = lazy(() =>
  import('@/pages/trust/enforcement').then((m) => ({ default: m.TrustEnforcementPage })),
);
// M26 — o registro de skills ganha superfície: acervo → detalhe (com a instrução resolvida) →
// versões e canais. As rotas só são alcançáveis por clique porque `resolveActiveMenu` reconhece
// `/skills`; declarar a rota aqui sem aquela linha entrega telas que ninguém encontra.
export const SkillsOverviewPage = lazy(() =>
  import('@/pages/skills/overview').then((m) => ({ default: m.SkillsOverviewPage })),
);
export const SkillDetailPage = lazy(() =>
  import('@/pages/skills/detail').then((m) => ({ default: m.SkillDetailPage })),
);
export const SkillVersionsPage = lazy(() =>
  import('@/pages/skills/versions').then((m) => ({ default: m.SkillVersionsPage })),
);
// M35 — a distribuição: pacotes e, dentro de cada um, os tokens delegados e a adoção. Declarar
// estas rotas sem a linha correspondente em `resolveActiveMenu` entregaria telas que ninguém
// encontra pelo menu — o defeito que o theo-trust levou três rodadas para achar.
export const SkillsDiscoveryPage = lazy(() =>
  import('@/pages/skills/discovery').then((m) => ({ default: m.SkillsDiscoveryPage })),
);
export const SkillsCatalogPage = lazy(() =>
  import('@/pages/skills/catalog').then((m) => ({ default: m.SkillsCatalogPage })),
);
export const SkillAuthoringPage = lazy(() =>
  import('@/pages/skills/authoring').then((m) => ({ default: m.SkillAuthoringPage })),
);
export const BundlesPage = lazy(() => import('@/pages/skills/bundles').then((m) => ({ default: m.BundlesPage })));
export const BundleDetailPage = lazy(() =>
  import('@/pages/skills/bundle-detail').then((m) => ({ default: m.BundleDetailPage })),
);// M25 — os prompts ganham superfície: catálogo → detalhe, onde a promoção de um label acontece.
// As rotas só são alcançáveis por clique porque `resolveActiveMenu` reconhece `/promptly`;
// declarar a rota aqui sem aquela linha entrega telas que ninguém encontra.
export const PromptlyOverviewPage = lazy(() =>
  import('@/pages/promptly/overview').then((m) => ({ default: m.PromptlyOverviewPage })),
);
// M13 — o catálogo saiu da raiz: `/promptly` virou o painel, como em memory/rag/lens.
export const PromptlyCatalogPage = lazy(() =>
  import('@/pages/promptly/catalogo').then((m) => ({ default: m.PromptlyCatalogPage })),
);
export const PromptDetailPage = lazy(() =>
  import('@/pages/promptly/detail').then((m) => ({ default: m.PromptDetailPage })),
);
export const PromptlyCreatePage = lazy(() =>
  import('@/pages/promptly/create').then((m) => ({ default: m.PromptlyCreatePage })),
);
export const PromptlyPlaygroundPage = lazy(() =>
  import('@/pages/promptly/playground').then((m) => ({ default: m.PromptlyPlaygroundPage })),
);
export const PromptlyDiffPage = lazy(() =>
  import('@/pages/promptly/diff').then((m) => ({ default: m.PromptlyDiffPage })),
);
// M44 — lens management dashboard pages; M46 — Overview landing
export const LensOverviewPage = lazy(() =>
  import('@/pages/lens/overview').then((m) => ({ default: m.LensOverviewPage })),
);
export const LensTracesPage = lazy(() =>
  import('@/pages/lens/traces').then((m) => ({ default: m.LensTracesPage })),
);
export const LensUsageByUserPage = lazy(() =>
  import('@/pages/lens/usage-by-user').then((m) => ({ default: m.LensUsageByUserPage })),
);
export const LensSessionsPage = lazy(() =>
  import('@/pages/lens/sessions').then((m) => ({ default: m.LensSessionsPage })),
);
export const LensSessionDetailPage = lazy(() =>
  import('@/pages/lens/session-detail').then((m) => ({ default: m.LensSessionDetailPage })),
);
export const LensDatasetsPage = lazy(() =>
  import('@/pages/lens/datasets').then((m) => ({ default: m.LensDatasetsPage })),
);
export const LensEvaluatorsPage = lazy(() =>
  import('@/pages/lens/evaluators').then((m) => ({ default: m.LensEvaluatorsPage })),
);
export const LensMonitorsPage = lazy(() =>
  import('@/pages/lens/monitors').then((m) => ({ default: m.LensMonitorsPage })),
);
export const LensAlertsPage = lazy(() =>
  import('@/pages/lens/alerts').then((m) => ({ default: m.LensAlertsPage })),
);
export const LensComparePage = lazy(() =>
  import('@/pages/lens/compare').then((m) => ({ default: m.LensComparePage })),
);
export const LensAgentsPage = lazy(() =>
  import('@/pages/lens/agents').then((m) => ({ default: m.LensAgentsPage })),
);
export const LensAskPage = lazy(() =>
  import('@/pages/lens/ask').then((m) => ({ default: m.LensAskPage })),
);
export const LensLabelingQueuePage = lazy(() =>
  import('@/pages/lens/labeling-queue').then((m) => ({ default: m.LensLabelingQueuePage })),
);
export const LensExperimentsPage = lazy(() =>
  import('@/pages/lens/experiments').then((m) => ({ default: m.LensExperimentsPage })),
);
export const LensDashboardsPage = lazy(() =>
  import('@/pages/lens/dashboards').then((m) => ({ default: m.LensDashboardsPage })),
);
export const LoginPage = lazy(() =>
  import('@/pages/auth/login').then((m) => ({ default: m.LoginPage })),
);
export const RegisterPage = lazy(() =>
  import('@/pages/auth/register').then((m) => ({ default: m.RegisterPage })),
);
// Red Team theo/theo#162 (2026-07-01): SPA-side page for the post-signup
// redirect target /auth/check-email that previously 404'd against the BFF.
export const CheckEmailPage = lazy(() =>
  import('@/pages/auth/check-email').then((m) => ({ default: m.CheckEmailPage })),
);
export const VerificationPage = lazy(() =>
  import('@/pages/auth/verification').then((m) => ({ default: m.VerificationPage })),
);
export const RecoveryPage = lazy(() =>
  import('@/pages/auth/recovery').then((m) => ({ default: m.RecoveryPage })),
);
export const DeviceSuccessPage = lazy(() =>
  import('@/pages/auth/device-success').then((m) => ({ default: m.DeviceSuccessPage })),
);
export const DeviceVerifyPage = lazy(() =>
  import('@/pages/auth/device-verify').then((m) => ({ default: m.DeviceVerifyPage })),
);
export const ProjectDetailPage = lazy(() =>
  import('@/pages/projects/project-detail').then((m) => ({ default: m.ProjectDetailPage })),
);
export const NotFoundPage = lazy(() =>
  import('@/pages/not-found').then((m) => ({ default: m.NotFoundPage })),
);
export const DeploymentsPage = lazy(() =>
  import('@/pages/deploy/deployments').then((m) => ({ default: m.DeploymentsPage })),
);
// Plan J-17 T5.1: layout + 4 tabs replace the 4 sibling routes below.
export const DeploymentDetailLayout = lazy(() =>
  import('@/pages/deploy/deployment-detail-layout').then((m) => ({ default: m.DeploymentDetailLayout })),
);
export const TimelineTab = lazy(() =>
  import('@/pages/deployment-tabs/timeline-tab').then((m) => ({ default: m.TimelineTab })),
);
export const LogsTab = lazy(() =>
  import('@/pages/deployment-tabs/logs-tab').then((m) => ({ default: m.LogsTab })),
);
export const SBOMTab = lazy(() =>
  import('@/pages/deployment-tabs/sbom-tab').then((m) => ({ default: m.SBOMTab })),
);
export const AttestationTab = lazy(() =>
  import('@/pages/deployment-tabs/attestation-tab').then((m) => ({ default: m.AttestationTab })),
);
// As três páginas autônomas de build (logs / SBOM / attestation) foram REMOVIDAS (#377).
// O comentário que as acompanhava dizia que ficavam "como fallback para links diretos" — e
// isso era falso e verificável: elas eram importadas, `void`adas e NÃO estavam roteadas em
// lugar nenhum, então link direto algum as alcançava. O que existe são as abas aninhadas
// `logs` / `sbom` / `attestation` sob /projects/:name/deployments/:id, logo abaixo.
export const RuntimeLogsPage = lazy(() =>
  import('@/pages/deploy/runtime-logs').then((m) => ({ default: m.RuntimeLogsPage })),
);
export const ProjectStatusPage = lazy(() =>
  import('@/pages/projects/project-status').then((m) => ({ default: m.ProjectStatusPage })),
);
export const SecretsPage = lazy(() =>
  import('@/pages/infra/secrets').then((m) => ({ default: m.SecretsPage })),
);
export const ProjectConnectPage = lazy(() =>
  import('@/pages/projects/project-connect').then((m) => ({ default: m.ProjectConnectPage })),
);
export const AuditPage = lazy(() =>
  import('@/pages/settings/audit').then((m) => ({ default: m.AuditPage })),
);
export const ProjectScalePage = lazy(() =>
  import('@/pages/projects/project-scale').then((m) => ({ default: m.ProjectScalePage })),
);
export const ProjectReadinessPage = lazy(() =>
  import('@/pages/projects/project-readiness').then((m) => ({ default: m.ProjectReadinessPage })),
);

/**
 * INVARIANTE deste arquivo, verificada em `src/lib/lazy-registry.test.ts`:
 * ele contém APENAS declarações `lazy()`.
 *
 * A tentação, no dia em que alguém precisar de um redirect novo, é pôr aqui —
 * "já que é sobre rotas". Foi assim que `app.tsx` chegou a 779 linhas: cada
 * acréscimo era defensável isolado.
 *
 * Um redirect é decisão de roteamento e mora em `app.tsx`, junto da árvore que
 * o aplica. Uma declaração `lazy()` é registro. Misturar os dois devolve o
 * problema com um nome novo.
 */
