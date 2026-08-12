import { useEffect, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { Badge, Button, Card, DataTable, type DataTableColumn, EmptyState, PageShell, Timestamp } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { getApiBase } from '@/lib/http/api';
import {
  useCreateMemoryExport,
  fetchMemoryExportStatus,
  type MemoryExport,
} from '@/hooks/memory/use-memory-exports';
import { safeNavigator } from '@/lib/navigation';

/**
 * Plan 3 of dashboard-memory-section-roadmap.md, T3.6.
 *
 * /memory/exports — async-job UI for memory exports.
 *
 *  - "Create export" button POSTs and adds a row in `pending` state
 *  - DataTable shows id (masked) + display_name + status badge + created_at
 *  - Active jobs (status pending|running) poll every 2s — D3 (EC-15):
 *    polling pauses when `document.visibilityState !== 'visible'`
 *  - Succeeded row gets a download link
 */

const POLL_INTERVAL_MS = 2000;

function statusVariant(s: MemoryExport['status']): 'default' | 'warning' | 'success' | 'destructive' {
  switch (s) {
    case 'pending':
      return 'default';
    case 'running':
      return 'warning';
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'destructive';
  }
}

export function ExportsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Exports'), [setPageTitle]);
  useRequireAuth();

  // v0.1 list source: client-side accumulator + per-id status polling.
  const [exports, setExports] = useState<MemoryExport[]>([]);

  const createMutation = useCreateMemoryExport();
  const onCreated = (row: MemoryExport) => {
      const fresh: MemoryExport = {
        id: row.id,
        display_name: row.display_name ?? null,
        status: row.status ?? 'pending',
        created_at: row.created_at,
        error_message: row.error_message,
      };
      setExports((prev) => [fresh, ...prev]);
  };

  // D3 (EC-15) — polling pauses when tab hidden. Implemented via a single
  // setInterval gated by visibilityState; visibilitychange flips the
  // listener back on without losing the existing timer.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      const active = exports.filter((e) => e.status === 'pending' || e.status === 'running');
      if (active.length === 0) return;
      const updates = await Promise.all(
        active.map((e) =>
          fetchMemoryExportStatus(e.id).catch(() => null),
        ),
      );
      const byId = new Map<string, MemoryExport>();
      for (const u of updates) {
        if (u) byId.set(u.id, u);
      }
      setExports((prev) => {
        const next: MemoryExport[] = [];
        for (const row of prev) {
          const u = byId.get(row.id);
          if (u) {
            next.push({ id: row.id, display_name: u.display_name ?? row.display_name, status: u.status, created_at: u.created_at ?? row.created_at, error_message: u.error_message ?? row.error_message });
          } else {
            next.push(row);
          }
        }
        return next;
      });
    };

    const arm = () => {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') void tick();
      }, POLL_INTERVAL_MS);
    };
    const disarm = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') arm();
      else disarm();
    };

    if (document.visibilityState === 'visible') arm();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      disarm();
    };
  }, [exports]);

  const columns: DataTableColumn<MemoryExport>[] = [
    {
      key: 'id',
      label: 'ID',
      render: (row) => (
        <code className="font-mono text-xs text-muted-foreground">{row.id.slice(0, 18)}…</code>
      ),
    },
    {
      key: 'display_name',
      label: 'Label',
      render: (row) =>
        row.display_name ? (
          <span>{row.display_name}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <Badge variant={statusVariant(row.status)} data-testid={`status-${row.id}`}>
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (row) =>
        row.created_at ? <Timestamp value={row.created_at} /> : <span className="text-xs">just now</span>,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) =>
        row.status === 'succeeded' ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Download export ${row.id}`}
            onClick={() => {
              // B-138: goes through the boundary like every other navigation. `row.id` is
              // server-supplied and was interpolated raw — encoded now, so an id carrying
              // `../` or a query separator cannot reshape the path.
              safeNavigator.goTo(
                `${getApiBase()}/v1/dashboard/memory/exports/${encodeURIComponent(row.id)}/download`,
              );
            }}
          >
            <Download className="size-4" />
          </Button>
        ) : null,
    },
  ];

  return (
    <PageShell
      title="Exports"
      description="Export your agent's memories to a portable JSON file."
      primaryAction={{
        label: 'Create export',
        icon: Plus,
        onClick: () => { createMutation.mutate(undefined, { onSuccess: onCreated }); },
        loading: createMutation.isPending,
      }}
    >
     <div className="space-y-6">
      {createMutation.isError ? (
        <Alert intent="warning" title="Could not start export">
          Try again in a moment.
        </Alert>
      ) : null}
      {exports.length === 0 ? (
        <EmptyState
          icon={Download}
          title="No exports yet"
          description="Click Create export to dump your memories as JSON."
        />
      ) : (
        <Card>
          <DataTable columns={columns} data={exports} rowKey={(row) => row.id} />
        </Card>
      )}
     </div>
    </PageShell>
  );
}
