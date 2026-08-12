import { Fragment, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Lock, Plus, Rocket, Trash2 } from 'lucide-react';
import { Button, Card, PageShell, StatusDot, Table } from '@usetheo/ui';
import { usePageMeta } from '@/hooks/use-page-meta';
import { estadoDaLista } from '@/lib/list-state';
import { useEngineApi } from '@/hooks/use-api';
import { useRequireAuth } from '@/hooks/use-auth';
import { CreateEnvironmentSheet } from '@/pages/infra/components/create-environment-sheet';
import { DeleteEnvironmentDialog } from '@/pages/infra/components/delete-environment-dialog';
import { PromoteDialog } from '@/pages/infra/components/promote-dialog';
import { EnvironmentKPIRow } from '@/pages/infra/components/environment-kpi-row';
import { PreviewRow, type PreviewSlot } from '@/pages/infra/components/preview-row';

interface Environment {
  name: string;
  status?: string;
  // Tupla (projeto, ambiente). Continua opcional no TIPO porque é o que o serviço declara
  // hoje na resposta de lista — mas a tela só renderiza entradas cujo projeto casa o da rota
  // (issue #377), então nada sem projeto chega ao render.
  project?: string;
  projects?: number;
  protected?: boolean;
  domain?: string;
  // KPI fields (v1.1 — page-level SSE multiplex will populate when wired)
  replicas?: number | null;
  uptime?: number | null;
  last_deploy?: string | null;
  last_deploy_sha?: string | null;
}

/**
 * Ambiente já recortado pelo projeto da rota — o projeto está presente por construção.
 *
 * Existe para que a garantia viva no TIPO e não só num comentário: depois do recorte, nenhum
 * consumidor precisa tratar "e se não tiver projeto?", porque esse caso não chega. Foi o que
 * permitiu exigir `project` no diálogo de exclusão ao remover o legado (issue #377).
 */
type ScopedEnvironment = Environment & { project: string };

interface EnvsResponse {
  environments: Environment[];
  // 2026-06-07 per-project model (migration 000028).
  // `permanent` is the list of permanent env names.
  // `previews` is one entry per PROJECT — the tenant can have N
  // projects, each with its own slot. Old API responses omit these
  // fields — the page degrades gracefully (legacy table only).
  permanent?: string[];
  previews?: PreviewSlot[];
}

type EnvStatusKind = 'live' | 'building' | 'failed' | 'idle' | 'warning';

function mapStatus(status?: string): EnvStatusKind {
  switch (status?.toLowerCase()) {
    case 'live':
    case 'active':
    case 'healthy':
      return 'live';
    case 'building':
    case 'deploying':
      return 'building';
    case 'failed':
    case 'error':
      return 'failed';
    case 'warning':
    case 'degraded':
      return 'warning';
    default:
      return 'idle';
  }
}

/**
 * Title-case a status string for display, handling snake_case (EC-9).
 *   'live'                  → 'Live'
 *   'pending_verification'  → 'Pending Verification'
 *   undefined / ''          → 'Idle'
 */
function statusLabel(s?: string): string {
  if (!s) return 'Idle';
  return s
    .split('_')
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * EnvironmentsPage — Plan J-10 v1.1.
 *
 * Wire-up of:
 *   - CreateEnvironmentSheet (existing, hook-driven)
 *   - DeleteEnvironmentDialog (NEW T2.2 — type-to-confirm + cascade warning)
 *   - PromoteDialog (refactored T2.3 — dropdowns + create-on-the-fly)
 *   - EnvironmentKPIRow (NEW T2.4 — 3 signals + honest empty state)
 *   - "View Previews →" cross-link (NEW T2.5 — strict CRD separation ADR D5)
 *
 * The page does NOT need to wire PlanLimitUpgradeModal — that's mounted
 * top-level in app.tsx and listens for `theo:plan-limit` window events
 * from the 402 interceptor in lib/api.ts.
 */
export function EnvironmentsPage() {
  useRequireAuth();
  const { setPageTitle } = usePageMeta();
  // B-167 — `error` já vinha de `useEngineApi` e não era desestruturado, então uma leitura que
  // falhou produzia zero ambientes e a tela afirmava "No environments yet".
  const { data, loading, error: erroDeLeitura } = useEngineApi<EnvsResponse>('/api/v1/environments');
  const [searchQuery, setSearchQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  // O alvo da exclusão carrega o projeto no TIPO: só linhas já recortadas pelo projeto da rota
  // chegam aqui, e o diálogo exige o campo (issue #377).
  const [deleteTarget, setDeleteTarget] = useState<ScopedEnvironment | null>(null);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteFrom, setPromoteFrom] = useState<string | undefined>(undefined);

  // M20: this page is now project-scoped (route /projects/:name/environments).
  // The project is the ROUTE param — no more guessing (`?project=` ?? first
  // project ?? the 'teste' fixture), which silently pointed create/promote/
  // delete at the wrong project. Every mutation below already reads projectName,
  // so it now always targets the project the user is looking at.
  const { name: projectName = '' } = useParams<{ name: string }>();

  // Recorta a lista do inquilino (a listagem do serviço é por inquilino, cruzando projetos)
  // para ESTE projeto. O predicado é um TYPE GUARD de propósito: depois dele o projeto está
  // presente por construção, e o compilador passa a saber disso — é o que permite exigir
  // `project` no diálogo de exclusão em vez de aceitá-lo opcional "por via das dúvidas".
  const environments = (data?.environments ?? []).filter(
    (e): e is ScopedEnvironment => e.project === projectName,
  );

  // A busca casa nome E projeto, e a forma `projeto/nome` casa a tupla exata.
  //
  // O ramo "entrada sem projeto casa só pelo nome" SAIU (issue #377): desde o M20 esta tela é
  // escopada pela rota, e o filtro acima já exige `project === projectName`. Uma entrada sem
  // projeto nunca chega aqui — o ramo era inalcançável, e código inalcançável que trata um caso
  // ensina o leitor a acreditar que o caso existe.
  const q = searchQuery.toLowerCase().trim();
  const filtered = environments.filter((e) => {
    if (!q) return true;
    const name = (e.name ?? '').toLowerCase();
    const proj = (e.project ?? '').toLowerCase();
    if (q.includes('/')) {
      const [qProj, qName] = q.split('/', 2);
      return proj === qProj && name.includes(qName ?? '');
    }
    return name.includes(q) || proj.includes(q);
  });

  // Agrupamento por projeto. Depois do filtro por rota há **sempre exatamente um grupo** — a
  // estrutura sobrevive porque o cabeçalho de grupo dá o contexto do projeto a quem usa leitor
  // de tela, não porque haja mais de um. O balde `__legacy__` (ADRs D2/D6), que existia para
  // entradas sem projeto e era inalcançável desde o M20, foi REMOVIDO por decisão do dono:
  // sem retrocompatibilidade. Uma entrada sem projeto não pertence a projeto algum, logo não
  // pertence a esta tela.
  const grouped = filtered.reduce<Record<string, ScopedEnvironment[]>>((acc, env) => {
    const key = env.project ?? '';
    if (!acc[key]) acc[key] = [];
    acc[key]!.push(env);
    return acc;
  }, {});
  const groupKeys = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

  // 2026-06-07 per-project model: N preview rows, one per project
  // that has had a preview at any time. Search filters by project_id
  // OR by the literal "preview" tag.
  const previews: PreviewSlot[] = data?.previews ?? [];
  const filteredPreviews = previews.filter((p) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      'preview'.includes(q) ||
      p.project_id.toLowerCase().includes(q) ||
      (p.active_branch ?? '').toLowerCase().includes(q)
    );
  });
  const showPreviewRows = data?.previews !== undefined && filteredPreviews.length > 0;

  return (
    <PageShell
      title="Environments"
      description={`Environments for ${projectName}.`}
      onTitleChange={setPageTitle}
      search={{
        // M20: scoped to one project now, so search is a simple name filter.
        placeholder: 'Search environments...',
        value: searchQuery,
        onChange: setSearchQuery,
      }}
      primaryAction={{
        label: 'New environment',
        icon: Plus,
        onClick: () => setCreateOpen(true),
      }}
      loading={loading}
      empty={estadoDaLista(
        {
          erro: erroDeLeitura,
          // 2026-06-07: page is empty only when BOTH permanent envs +
          // every preview row are absent.
          vazio:
            !loading && filtered.length === 0 && !showPreviewRows
              ? {
                  icon: Box,
                  title: searchQuery
                    ? 'No matching environments'
                    : 'No environments yet',
                  description: searchQuery
                    ? 'Try a different search term.'
                    : 'Environments are created automatically per project on first deploy.',
                }
              : undefined,
        },
        'environments',
      )}
    >
      {/* Plan 2026-06-08-dashboard-screens-review-fixes T1.1 + ADR D1 —
          previous J-10 T2.5 "View Previews" cross-link dropped because
          /projects/:name/previews now redirects back to this page (the
          single preview slot under M2 model is rendered inline below via
          PreviewRow). A self-link would loop and is removed. */}

      <Card>
        <Card.Body className="p-0">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Name</Table.HeaderCell>
                <Table.HeaderCell>
                  Health
                </Table.HeaderCell>
                <Table.HeaderCell className="hidden md:table-cell">
                  Status
                </Table.HeaderCell>
                <Table.HeaderCell className="hidden md:table-cell">
                  Protected
                </Table.HeaderCell>
                <Table.HeaderCell align="right">
                  <span className="sr-only">Actions</span>
                </Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {/* 2026-06-07 per-project model: one preview row per
                  project. Old backends omit `previews` → no rows
                  rendered here, legacy permanent rows still render
                  below. */}
              {showPreviewRows &&
                filteredPreviews.map((slot) => (
                  <PreviewRow key={slot.project_id} slot={slot} />
                ))}
              {/* Cabeçalho de grupo por projeto — dá a quem usa leitor de tela o contexto do
                  projeto antes das linhas que o seguem. O ramo "(legacy) — no project" saiu
                  junto com o balde (issue #377). */}
              {groupKeys.map((key) => {
                const envs = grouped[key] ?? [];
                return (
                  <Fragment key={key}>
                    <Table.Row
                      data-testid={`env-group-header-${key}`}
                      aria-label={`Project group: ${key}`}
                      role="rowheader"
                    >
                      <Table.Cell colSpan={5} className="bg-muted/30">
                        <span className="text-label uppercase tracking-wide text-muted-foreground">
                          <span className="font-semibold text-foreground">
                            project / <span className="font-mono">{key}</span>
                          </span>
                        </span>
                      </Table.Cell>
                    </Table.Row>
                    {envs.map((env) => (
                      <Table.Row key={`${key}::${env.name}`}>
                        <Table.Cell>
                          <span className="font-mono text-body-sm text-foreground">
                            <span className="text-muted-foreground">{env.project}/</span>
                            {env.name}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <EnvironmentKPIRow
                            replicas={env.replicas}
                            uptime={env.uptime}
                            lastDeploy={env.last_deploy}
                            lastDeploySha={env.last_deploy_sha}
                          />
                        </Table.Cell>
                        <Table.Cell>
                          <StatusDot
                            status={mapStatus(env.status)}
                            label={statusLabel(env.status)}
                          />
                        </Table.Cell>
                        <Table.Cell className="hidden md:table-cell">
                          {env.protected ? (
                            <span className="inline-flex items-center gap-1 text-warning text-label">
                              <Lock className="size-3" aria-hidden="true" />
                              Protected
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-label">—</span>
                          )}
                        </Table.Cell>
                        <Table.Cell align="right">
                          <div className="inline-flex items-center gap-1">
                            {(env.status ?? '').toLowerCase() === 'active' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setPromoteFrom(env.name);
                                  setPromoteOpen(true);
                                }}
                                aria-label={`Promote release from ${env.name}`}
                              >
                                <Rocket className="size-4 text-primary" aria-hidden="true" />
                              </Button>
                            )}
                            {!env.protected && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setDeleteTarget(env)}
                                aria-label={`Delete ${env.name}`}
                              >
                                <Trash2
                                  className="size-4 text-destructive"
                                  aria-hidden="true"
                                />
                              </Button>
                            )}
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Fragment>
                );
              })}
            </Table.Body>
          </Table>
        </Card.Body>
      </Card>

      <CreateEnvironmentSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        // M20: the page is project-scoped — fix the new env's project to the
        // route project (the picker is locked, no "pick a project" step).
        defaultProject={projectName}
      />

      {deleteTarget && (
        <DeleteEnvironmentDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          envName={deleteTarget.name}
          // Propaga o projeto para o DELETE filtrar pela tupla. Sempre presente: a linha só
          // renderiza quando o projeto casa o da rota.
          project={deleteTarget.project}
          // M15 T3: no fabricated cascade counts. `deleteTarget.projects` is a
          // project count, NOT a workload count, and there is no
          // GET /environments/:name/cascade-preview endpoint to source real
          // secrets/domains numbers. Passing no cascade → the dialog shows its
          // honest qualitative warning ("All workloads, secrets, and domains …
          // will be deleted") instead of a misleading number.
          onDeleted={() => setDeleteTarget(null)}
        />
      )}

      <PromoteDialog
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
        projectName={projectName}
        environments={environments}
        initialFrom={promoteFrom}
        onCreateRequested={() => {
          // Open create sheet without closing promote dialog state.
          setCreateOpen(true);
        }}
        onPromoted={() => {
          setPromoteOpen(false);
          setPromoteFrom(undefined);
        }}
      />
    </PageShell>
  );
}
