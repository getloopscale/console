import { lensErrorMessage } from '@/pages/lens/lens-error';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  MetricCard,
  PageShell,
  PercentileChart,
  Select,
  Skeleton,
  Timestamp,
} from '@usetheo/ui';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { Alert } from '@/components/ui/alert-guard';
import { nextBoardName } from './dashboards/board-name';
import { DurationHistogram } from './dashboards/duration-histogram';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/http/api';
import { LIST_SAFETY_CEILING } from '@/lib/http/list-ceiling';
import { formatCost, formatDuration, formatNumber } from '@/lib/formatting/format';
import { TrendChart } from '@usetheo/ui';
import type { TrafficBucket, LatencyBucket, ModelBucket } from '@/pages/lens/components/lens-series';
import {
  TRACING_OVERVIEW_TEMPLATE,
  WIDGET_TYPES,
  WIDGET_METRICS,
  WIDGET_TYPE_LABEL,
  METRIC_LABEL,
  validateConfig,
  addWidget,
  removeWidget,
  moveWidget,
  bindKpi,
  bindTrend,
  bindLatencyBuckets,
  bindTopN,
  type Widget,
  type WidgetType,
  type WidgetMetric,
  type BoardData,
  type TopNRow,
} from './dashboards/widgets';

/**
 * M66 — /observability/dashboards. A per-workspace custom-dashboard board: a fixed widget palette
 * (KPI tile / trend chart / top-N table) bound to the existing M51/M60 series, a code-defined
 * "Tracing Overview" template, and ordered-list editing (add/remove/move — no drag-grid, D4). Every
 * widget derives from ONE shared observability + ONE cost fetch (the fan-out fix, R5). Every write
 * is Principal-scoped upstream (the M52 saved-views pattern); a load/scope error fails closed to a
 * typed Alert, never a fabricated board.
 */

interface DashboardRow {
  id: string;
  name: string;
  config: Widget[];
  createdBy?: string;
  createdAt?: string;
}
interface ObservabilityResult {
  traffic: TrafficBucket[];
  latency: LatencyBucket[];
  tokensByModel: ModelBucket[];
}
/** Map an API error's HTTP status to a typed, actionable message (fail-closed). */
function errorMessage(err: unknown): string {
  return lensErrorMessage(
    err,
    {
      403: 'You do not have permission to manage dashboards in this workspace.',
      404: 'That dashboard is not available (it may belong to another workspace).',
    },
    'Could not load dashboards — try again shortly.',
  );
}

const TOPN_COLUMNS: DataTableColumn<TopNRow>[] = [
  { key: 'model', label: 'Model', render: (r) => <span className="font-mono text-xs">{r.model}</span> },
  { key: 'tokens', label: 'Tokens', render: (r) => <span className="text-xs">{formatNumber(r.totalTokens, 'grouped')}</span> },
  { key: 'cost', label: 'Cost', render: (r) => <span className="text-xs">{formatCost(r.costUsd)}</span> },
];

/** One rendered widget bound to the shared board data. */
function WidgetView({ widget, data }: { widget: Widget; data: BoardData }) {
  const title = widget.title ?? METRIC_LABEL[widget.metric];
  if (widget.type === 'kpi') {
    return <MetricCard title={title} value={<span data-testid="kpi-value">{bindKpi(widget.metric, data)}</span>} />;
  }
  if (widget.type === 'topn') {
    const rows = bindTopN(data);
    return (
      <Card>
        <Card.Body className="space-y-2">
          <div className="text-xs font-semibold uppercase text-muted-foreground">{title}</div>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data for this range yet.</p>
          ) : (
            <DataTable data={rows} columns={TOPN_COLUMNS} rowKey={(r) => r.model} />
          )}
        </Card.Body>
      </Card>
    );
  }
  // M11 — the latency trend is a banded PercentileChart (p50–p95–p99 as shaded areas), the upgrade
  // over the old three-line p50/p95/p99 overlay. Every other trend metric stays a TrendChart.
  if (widget.metric === 'p95_latency') {
    return (
      <Card>
        <Card.Body>
          <PercentileChart title={title} buckets={bindLatencyBuckets(data)} valueFormatter={(v) => formatDuration(v)} />
        </Card.Body>
      </Card>
    );
  }
  const series = bindTrend(widget.metric, data);
  return (
    <Card>
      <Card.Body>
        <TrendChart title={title} series={series} />
      </Card.Body>
    </Card>
  );
}

/** The edit row for one widget: type + metric Selects + move/remove controls (ordered-list, no grid). */
function WidgetEditor({
  widget,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  widget: Widget;
  index: number;
  count: number;
  onChange: (w: Widget) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-2" data-testid="widget-editor">
      <Select value={widget.type} onValueChange={(v) => onChange({ ...widget, type: v as WidgetType })}>
        <Select.Trigger className="w-[140px]" aria-label={`Widget ${index + 1} type`}>
          <Select.Value />
        </Select.Trigger>
        <Select.Content>
          {WIDGET_TYPES.map((t) => (
            <Select.Item key={t} value={t}>{WIDGET_TYPE_LABEL[t]}</Select.Item>
          ))}
        </Select.Content>
      </Select>
      <Select value={widget.metric} onValueChange={(v) => onChange({ ...widget, metric: v as WidgetMetric })}>
        <Select.Trigger className="w-[180px]" aria-label={`Widget ${index + 1} metric`}>
          <Select.Value />
        </Select.Trigger>
        <Select.Content>
          {WIDGET_METRICS.map((m) => (
            <Select.Item key={m} value={m}>{METRIC_LABEL[m]}</Select.Item>
          ))}
        </Select.Content>
      </Select>
      <Button variant="ghost" size="sm" aria-label={`Move widget ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)}>↑</Button>
      <Button variant="ghost" size="sm" aria-label={`Move widget ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)}>↓</Button>
      <Button variant="ghost" size="sm" aria-label={`Remove widget ${index + 1}`} onClick={onRemove}>Remove</Button>
    </div>
  );
}

export function LensDashboardsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Dashboards'), [setPageTitle]);
  useRequireAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const boardId = params.get('board') ?? '';
  const [range] = useState('24h');

  // Draft edit state (null = view mode).
  const [draft, setDraft] = useState<{ name: string; widgets: Widget[] } | null>(null);
  // M75 list-management state: which row is being renamed inline, its draft value, and a pending delete.
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DashboardRow | null>(null);

  const listQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/dashboards'] as const,
    queryFn: () => cloudFetch<{ dashboards: DashboardRow[] }>(`/v1/dashboard/lens/dashboards?limit=${LIST_SAFETY_CEILING}`, {}, { throwOnError: true }),
  });
  const boardQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/dashboards', boardId] as const,
    queryFn: () => cloudFetch<DashboardRow>(`/v1/dashboard/lens/dashboards/${encodeURIComponent(boardId)}`, {}, { throwOnError: true }),
    enabled: boardId.length > 0,
  });

  // The ONE shared, range-scoped fetch every widget binds against (no per-widget fan-out). The cost
  // KPI derives from this same fetch's `tokensByModel` so the whole board shares one time window —
  // the previous separate all-time `/cost` fetch made the cost KPI disagree with the cost trend.
  const obs = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/observability', range] as const,
    queryFn: () => cloudFetch<ObservabilityResult>(`/v1/dashboard/lens/observability?range=${range}`, {}, { throwOnError: true }),
    enabled: boardId.length > 0,
  });
  const data: BoardData = {
    ...(obs.data ? { observability: obs.data } : {}),
  };
  const dataError = obs.isError;

  const create = useMutation({
    mutationFn: (board: { name: string; config: Widget[] }) =>
      cloudFetch<DashboardRow>('/v1/dashboard/lens/dashboards', { method: 'POST', body: JSON.stringify(board) }, { throwOnError: true }),
    retry: false,
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/dashboards'] });
      if (row) setParams({ board: row.id });
    },
  });
  const save = useMutation({
    mutationFn: (board: { name: string; config: Widget[] }) =>
      cloudFetch<DashboardRow>(`/v1/dashboard/lens/dashboards/${encodeURIComponent(boardId)}`, { method: 'PUT', body: JSON.stringify(board) }, { throwOnError: true }),
    retry: false,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/dashboards', boardId] });
      setDraft(null);
    },
  });
  // M75 — rename a board from the list. PUT is a full replace, so echo the row's config back to
  // avoid blanking its widgets (Drawbacks R2).
  const rename = useMutation({
    mutationFn: (b: { id: string; name: string; config: Widget[] }) =>
      cloudFetch<DashboardRow>(`/v1/dashboard/lens/dashboards/${encodeURIComponent(b.id)}`, { method: 'PUT', body: JSON.stringify({ name: b.name, config: b.config }) }, { throwOnError: true }),
    retry: false,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/dashboards'] });
      setRenaming(null);
    },
  });
  // M75 — delete a board from the list (existing cloud DELETE verb).
  const remove = useMutation({
    mutationFn: (id: string) =>
      cloudFetch<void>(`/v1/dashboard/lens/dashboards/${encodeURIComponent(id)}`, { method: 'DELETE' }, { throwOnError: true }),
    retry: false,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/dashboards'] });
      setPendingDelete(null);
    },
  });
  const commitRename = () => {
    if (!renaming) return;
    const row = (listQuery.data?.dashboards ?? []).find((b) => b.id === renaming.id);
    const name = renaming.value.trim();
    if (!row || name.length === 0 || name === row.name) {
      setRenaming(null);
      return;
    }
    rename.mutate({ id: row.id, name, config: row.config });
  };

  // ── List view (no board selected) ──────────────────────────────────────────
  if (!boardId) {
    const boards = listQuery.data?.dashboards ?? [];
    return (
      <PageShell title="Dashboards" description="Custom boards of KPI, trend, and top-N widgets bound to your telemetry.">
        {listQuery.isError ? (
          <Alert intent="warning" title="Could not load dashboards" description={errorMessage(listQuery.error)} />
        ) : listQuery.isPending ? (
          <Skeleton className="h-24 w-full" aria-label="Loading dashboards" />
        ) : boards.length === 0 ? (
          <EmptyState
            icon={LayoutDashboard}
            title="No dashboards yet"
            description="Start from the Tracing Overview template — a KPI strip, a traffic trend, and top models by cost."
            action={
              <Button onClick={() => create.mutate({ name: nextBoardName([]), config: TRACING_OVERVIEW_TEMPLATE })} disabled={create.isPending}>
                {create.isPending ? 'Creating…' : 'Start from Tracing Overview'}
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            <Button
              size="sm"
              onClick={() => create.mutate({ name: nextBoardName(boards.map((b) => b.name)), config: TRACING_OVERVIEW_TEMPLATE })}
              disabled={create.isPending}
            >
              + New from template
            </Button>
            <DataTable
              data={boards}
              rowKey={(b) => b.id}
              columns={[
                {
                  key: 'name',
                  label: 'Dashboard',
                  render: (b) =>
                    renaming?.id === b.id ? (
                      <Input
                        autoFocus
                        aria-label={`Rename dashboard ${b.name}`}
                        value={renaming.value}
                        onChange={(e) => setRenaming({ id: b.id, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        onBlur={commitRename}
                        className="max-w-[220px]"
                      />
                    ) : (
                      <button className="text-sm underline" onClick={() => setParams({ board: b.id })}>{b.name}</button>
                    ),
                },
                { key: 'widgets', label: 'Widgets', render: (b) => <Badge variant="outline">{b.config.length}</Badge> },
                { key: 'created', label: 'Created', render: (b) => (b.createdAt ? <Timestamp value={b.createdAt} /> : <span className="text-muted-foreground">—</span>) },
                {
                  key: 'actions',
                  label: '',
                  align: 'right',
                  render: (b) => (
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" aria-label={`Rename ${b.name}`} onClick={() => setRenaming({ id: b.id, value: b.name })}>Rename</Button>
                      {/* preventDefault on mousedown keeps focus in the rename Input (no blur-commit);
                          the onClick then cancels any in-progress rename and opens the delete dialog. */}
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete ${b.name}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setRenaming(null);
                          setPendingDelete(b);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        )}
        {create.isError ? <Alert intent="warning" title="Could not create" description={errorMessage(create.error)} data-testid="create-error" /> : null}
        {rename.isError ? <Alert intent="warning" title="Could not rename" description={errorMessage(rename.error)} data-testid="rename-error" /> : null}
        {remove.isError ? <Alert intent="warning" title="Could not delete" description={errorMessage(remove.error)} data-testid="delete-error" /> : null}
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          title={pendingDelete ? `Delete “${pendingDelete.name}”?` : ''}
          description="This permanently removes the dashboard board. This cannot be undone."
          confirmLabel={remove.isPending ? 'Deleting…' : 'Delete dashboard'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={remove.isPending}
          onConfirm={() => {
            if (pendingDelete) remove.mutate(pendingDelete.id);
          }}
        />
      </PageShell>
    );
  }

  // ── Board view / editor ────────────────────────────────────────────────────
  const board = boardQuery.data;
  const editing = draft !== null;
  const widgets = editing ? draft.widgets : board?.config ?? [];
  const validationError = editing ? validateConfig(draft.name, draft.widgets) : null;

  return (
    <PageShell
      title={board?.name ?? 'Dashboard'}
      description="A custom board of widgets bound to your observability series."
    >
      <div className="mb-3 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setParams({})}>← All dashboards</Button>
        {editing ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>Cancel</Button>
            <Button size="sm" disabled={!!validationError || save.isPending} onClick={() => save.mutate({ name: draft.name, config: draft.widgets })}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </>
        ) : board ? (
          <Button variant="ghost" size="sm" onClick={() => setDraft({ name: board.name, widgets: board.config })}>Edit</Button>
        ) : null}
      </div>
      {boardQuery.isError ? (
        <Alert intent="warning" title="Could not load this dashboard" description={errorMessage(boardQuery.error)} data-testid="board-error" />
      ) : boardQuery.isPending ? (
        <Skeleton className="h-40 w-full" aria-label="Loading dashboard" />
      ) : (
        <>
          {editing ? (
            <div className="mb-4 space-y-2" data-testid="editor">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Dashboard name" className="max-w-sm" />
              {draft.widgets.map((w, i) => (
                <WidgetEditor
                  key={i}
                  widget={w}
                  index={i}
                  count={draft.widgets.length}
                  onChange={(nw) => setDraft({ ...draft, widgets: draft.widgets.map((x, xi) => (xi === i ? nw : x)) })}
                  onMove={(dir) => setDraft({ ...draft, widgets: moveWidget(draft.widgets, i, dir) })}
                  onRemove={() => setDraft({ ...draft, widgets: removeWidget(draft.widgets, i) })}
                />
              ))}
              <Button variant="secondary" size="sm" onClick={() => setDraft({ ...draft, widgets: addWidget(draft.widgets, { type: 'kpi', metric: 'traces' }) })}>+ Add widget</Button>
              {validationError ? <p className="text-xs text-destructive">{validationError}</p> : null}
            </div>
          ) : null}

          {dataError ? (
            <Alert intent="warning" title="Could not load the widget data" description="The observability series is unavailable — widgets show no data." data-testid="data-error" />
          ) : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {widgets.map((w, i) => (
              <WidgetView key={i} widget={w} data={dataError ? {} : data} />
            ))}
          </div>

          {/* M11 — the trace-duration distribution histogram (its own traces fetch; not a configurable widget). */}
          <div className="mt-3">
            <DurationHistogram />
          </div>
        </>
      )}
      {save.isError ? <Alert intent="warning" title="Could not save" description={errorMessage(save.error)} data-testid="save-error" /> : null}
    </PageShell>
  );
}
