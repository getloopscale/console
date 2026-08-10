import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useQueryState, parseAsString } from 'nuqs';
import { Brain, Download, History, ShieldAlert, X } from 'lucide-react';
import { Badge, Button, Card, PageShell, Table } from '@usetheo/ui';
import { useSetPageTitle } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { engineFetch } from '@/lib/http/api';
import { formatDate } from '@/lib/formatting/format';
import { triggerAuditCsvDownload } from '@/pages/settings/audit-csv';
import type { AuditListResponse, AuditSeverity } from '@/lib/api/types';

const SEVERITY_BADGE: Record<
  AuditSeverity,
  'default' | 'warning' | 'destructive' | 'success'
> = {
  info: 'default',
  warning: 'warning',
  critical: 'destructive',
};

/**
 * #126 (qa-dogfood-cleanup-2026-06-21 T5.2 / ADR-Q4 dashboard-side
 * fallback): legacy audit rows surfaced raw DB ops (`INSERT`, `UPDATE`,
 * `DELETE`) with the table name in `resource_type`. The boundary-side
 * canonical fix (closed enum at emitter) is tracked separately; this
 * helper is the defense-in-depth so the user never sees a SQL leak.
 * Returns the original action string when no remap applies.
 */
export function displayAction(action: string, resourceType?: string | null): string {
  if (!action) return '[unmapped]';
  const a = action.toUpperCase();
  if (a === 'INSERT' && resourceType === 'tenant_members')
    return 'tenant.member.added';
  if (a === 'DELETE' && resourceType === 'tenant_members')
    return 'tenant.member.removed';
  if (a === 'INSERT' && resourceType === 'projects')
    return 'project.created';
  if (a === 'DELETE' && resourceType === 'projects')
    return 'project.deleted';
  // Any other raw SQL op: mark explicitly so the row is honest about
  // the leak without crashing on missing label lookups.
  if (a === 'INSERT' || a === 'UPDATE' || a === 'DELETE') {
    const suffix = resourceType ? ` ${resourceType}` : '';
    return `[unmapped: ${action.toLowerCase()}${suffix}]`;
  }
  return action;
}

/**
 * AuditPage — Plan v1.0 T5.1.
 *
 * Workspace-wide audit log. Shows actor + action + resource + severity +
 * timestamp. Filterable by action (substring) and actor email. Backend
 * GET /api/v1/audit returns entries already sorted desc by ts.
 */
/** Teto por pagina. Espelha SESSIONS_PAGE_SIZE (pages/lens/sessions.tsx:42). */
const AUDIT_PAGE_SIZE = 50;

export function AuditPage() {
  useRequireAuth();
  useSetPageTitle('Audit log');
  // B-024 — teto explicito. O request nao tinha limit nem offset: pedia a
  // auditoria INTEIRA e renderizava tudo. Num workspace com meses de atividade
  // isso e uma resposta sem tamanho previsivel indo para a memoria e para a
  // arvore da pagina.
  //
  // Segue o padrao ja em uso em `pages/lens/sessions.tsx:54-60` — mesmo
  // PAGE_SIZE explicito, mesmo calculo de pageCount, mesma UI de navegacao.
  const [page, setPage] = useState(1);
  // T2.3: filters live in URL — bookmarkable + browser back/forward works.
  const [actionFilter, setActionFilter] = useQueryState(
    'action',
    parseAsString.withDefault(''),
  );
  const [actorFilter, setActorFilter] = useQueryState(
    'actor',
    parseAsString.withDefault(''),
  );
  // Plan 4 of dashboard-memory-section-roadmap.md, T4.3 (ADR D3) —
  // client-side source filter. Independent URL state from action/actor so
  // bookmarks work. Backend `?source=memory` is owned by the engine API
  // and is intentionally OUT OF SCOPE for this loop; when a future plan
  // ships it, this component can swap to URL/backend without API change.
  const [sourceFilter, setSourceFilter] = useQueryState(
    'source',
    parseAsString.withDefault(''),
  );

  // Migrado de `useEffect` + `useState` para a camada de query. O motivo nao e
  // uniformidade: o codigo anterior fazia `data?.entries ?? []`, entao uma falha
  // de rede virava LISTA VAZIA — a tela dizia "nenhum registro de auditoria"
  // quando a verdade era "nao consegui perguntar". Numa tela de AUDITORIA isso e
  // especialmente caro: ausencia de registro e exatamente o que alguem
  // investigando um incidente procura.
  //
  // O guard de null silencioso nao pegava porque ele quantifica sobre
  // `useQuery`/`useInfiniteQuery`/`useSuspenseQuery`, e aqui era `engineFetch`
  // cru dentro de um efeito.
  const query = useQuery({
    queryKey: ['engine', '/api/v1/audit', { actionFilter, actorFilter, page }] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      if (actionFilter.trim()) params.set('action', actionFilter.trim());
      if (actorFilter.trim()) params.set('actor', actorFilter.trim());
      params.set('limit', String(AUDIT_PAGE_SIZE));
      params.set('offset', String((page - 1) * AUDIT_PAGE_SIZE));
      return engineFetch<AuditListResponse>(`/api/v1/audit?${params.toString()}`, {}, { throwOnError: true });
    },
  });

  const entries = query.data?.entries ?? [];
  const total = query.data?.total ?? 0;
  const loading = query.isLoading;
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));

  // Trocar filtro reinicia a paginacao: manter a pagina 7 ao filtrar por outro
  // ator mostra uma tela vazia que parece "sem resultados".
  useEffect(() => setPage(1), [actionFilter, actorFilter]);

  // T4.3 — client-side memory filter. Matches resource_type beginning
  // with 'memory' (covers memory + memory_export + memory_webhook). When
  // source filter is inactive (empty), passes all entries through.
  const visibleEntries = useMemo(() => {
    if (sourceFilter !== 'memory') return entries;
    return entries.filter((e) =>
      typeof e.resource_type === 'string' && e.resource_type.toLowerCase().startsWith('memory'),
    );
  }, [entries, sourceFilter]);

  return (
    <PageShell
      title="Audit log"
      description="Workspace activity history."
      search={{
        placeholder: 'Filter by action prefix (e.g., deploy)',
        value: actionFilter,
        onChange: setActionFilter,
      }}
      primaryAction={
        // J-14 CSV export — export the currently-visible rows (WYSIWYG:
        // honors the active action/actor/source filters). Omitted when there
        // is nothing to export.
        visibleEntries.length > 0
          ? {
              label: 'Export CSV',
              icon: Download,
              onClick: () => triggerAuditCsvDownload(visibleEntries),
            }
          : undefined
      }
      loading={loading}
      empty={
        !loading && visibleEntries.length === 0
          ? {
              icon: History,
              title: sourceFilter === 'memory' ? 'No memory activity in this period' : 'No audit entries',
              description:
                sourceFilter === 'memory'
                  ? 'Memory-related entries will appear here as your agent records or recalls memories.'
                  : 'Activity will appear here as your team uses the workspace.',
            }
          : undefined
      }
    >
      {/* Plan 4 of dashboard-memory-section-roadmap.md, T4.3 — Memory source filter chip.
          Client-side (D3); backend `?source=memory` is OUT OF SCOPE for this loop. */}
      <div className="flex items-center gap-2 mb-4" data-testid="audit-source-filter">
        <span className="text-label-caps text-muted-foreground uppercase tracking-wider">
          Source:
        </span>
        {sourceFilter === 'memory' ? (
          <Badge variant="default" className="gap-1">
            <Brain className="size-3" aria-hidden="true" />
            Memory
            <button
              type="button"
              aria-label="Clear memory source filter"
              onClick={() => setSourceFilter('')}
              className="ml-1 hover:opacity-70"
            >
              <X className="size-3" />
            </button>
          </Badge>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSourceFilter('memory')}
            className="gap-1"
          >
            <Brain className="size-3.5" aria-hidden="true" />
            Filter by Memory
          </Button>
        )}
      </div>

      <Card>
        <Card.Body className="p-0">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>When</Table.HeaderCell>
                <Table.HeaderCell>Actor</Table.HeaderCell>
                <Table.HeaderCell>Action</Table.HeaderCell>
                <Table.HeaderCell className="hidden md:table-cell">
                  Resource
                </Table.HeaderCell>
                <Table.HeaderCell align="right">Severity</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {visibleEntries.map((e, idx) => (
                // #125 (qa-dogfood-cleanup-2026-06-21 T5.1): composite key
                // — `e.id` is the canonical key, but legacy audit rows
                // surfaced with `id === ''` (or null) under #126, which
                // collapses to a single React key and emits the "unique
                // key prop" warning. Falling back to `idx` for those rows
                // is safe because the list is read-only + non-reordered
                // within a render (entries[] is replaced wholesale on
                // each fetch, so React's reconciliation by-index is
                // never wrong).
                <Table.Row key={e.id ? e.id : `idx:${idx}`}>
                  <Table.Cell>
                    <span className="font-mono text-label text-muted-foreground tabular-nums">
                      {/* QA Run-3 #126: wire shape canonical is
                          `timestamp` (per api/internal/domain/types.go
                          AuditEntryResult json:"timestamp"); legacy
                          `ts` alias kept as fallback. */}
                      {formatDate(e.timestamp || e.ts, 'relative')}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="text-body-sm text-foreground">
                      {/* QA Run-3 #126: wire shape is `actor` (email
                          or system identifier); legacy `actor_email`
                          kept as fallback. Explicit "[unknown]" when
                          truly absent (distinct from WHEN missing). */}
                      {e.actor || e.actor_email || '[unknown]'}
                    </span>
                    {(e.actor_kind || (e.actor && e.actor.includes('@'))) && (
                      <Badge
                        variant="outline"
                        className="ml-2 text-label uppercase"
                      >
                        {/* Derive actor_kind: emails → user, else system. */}
                        {e.actor_kind ?? (e.actor && e.actor.includes('@') ? 'user' : 'system')}
                      </Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <span className="font-mono text-label text-foreground">
                      {/* #126 (qa-dogfood-cleanup-2026-06-21 T5.2): map
                          raw SQL ops to the closest domain event for
                          display. Boundary-side filter still owes the
                          canonical fix (ADR-Q4 closed enum at emitter);
                          this is the dashboard defense-in-depth fallback
                          so legacy rows render readable text instead of
                          leaking `INSERT tenant_members`. */}
                      {displayAction(e.action, e.resource_type)}
                    </span>
                  </Table.Cell>
                  <Table.Cell className="hidden md:table-cell">
                    {e.resource_type && (
                      <>
                        <span className="font-mono text-label text-muted-foreground">
                          {e.resource_type}
                        </span>
                        {e.resource_id && (
                          <span className="ml-1 font-mono text-label text-foreground">
                            · {e.resource_id}
                          </span>
                        )}
                      </>
                    )}
                  </Table.Cell>
                  <Table.Cell align="right">
                    {/* QA Run-3 #126: backend wire shape lacks `severity`
                        today; render 'info' default until upstream
                        domain.AuditEntryResult adds the field. */}
                    {(() => {
                      const sev = e.severity ?? 'info';
                      return (
                        <Badge
                          variant={SEVERITY_BADGE[sev]}
                          className="text-label uppercase"
                        >
                          {sev === 'critical' && (
                            <ShieldAlert className="size-3 mr-1" aria-hidden="true" />
                          )}
                          {sev}
                        </Badge>
                      );
                    })()}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Card.Body>
        {/* B-024 — navegacao entre paginas, espelhando pages/lens/sessions.tsx:215-224.
            So aparece quando ha mais de uma pagina: um controle desabilitado permanente
            e ruido que ensina o usuario a ignora-lo. */}
        {pageCount > 1 && (
          <Card.Footer>
            <div className="flex items-center justify-between gap-4">
              <span className="text-label text-muted-foreground">
                Page {page} of {pageCount} · {total} records
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page <= 1 || query.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= pageCount || query.isFetching}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </Card.Footer>
        )}
      </Card>

      <input type="hidden" value={actorFilter} onChange={() => setActorFilter('')} />
    </PageShell>
  );
}
