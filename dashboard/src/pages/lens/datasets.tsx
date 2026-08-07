import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useQueryState, parseAsString } from 'nuqs';
import { Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  Label,
  PageShell,
  Timestamp,
} from '@usetheo/ui';
import { AppModal } from '@/components/ui/app-modal';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { ListSkeleton } from '@/components/lens/list-skeleton';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/http/api';
import { TracePeekSheet } from './traces/peek-sheet';

/**
 * M44 — /lens/datasets. List / create datasets and remove items via the read+write lens
 * management BFF (`/v1/dashboard/lens/datasets`). Mirrors the theo-rag collections page. The
 * BFF passes theo-lens's shape through verbatim, so the types match theo-lens: datasets carry
 * {id,name,createdAt,itemCount}; the detail carries {items:[{traceId}]}.
 */

interface Dataset {
  id: string;
  name: string;
  createdAt?: string;
  itemCount?: number;
}
interface DatasetsResult {
  datasets: Dataset[];
}
interface DatasetItem {
  traceId: string;
  createdAt?: string;
}
interface DatasetDetail {
  id: string;
  name: string;
  items: DatasetItem[];
}

/** Map a write error's HTTP status to a typed, actionable message (M82 — a 409 name-conflict must
 *  read as "already in use", NEVER a generic failure). */
function writeErrorMessage(err: unknown): string {
  const status = (err as { status?: number } | null)?.status ?? 0;
  switch (status) {
    case 409:
      return 'A dataset with that name already exists in this workspace.';
    case 403:
      return 'You do not have permission to manage datasets in this workspace.';
    case 404:
      return 'That dataset is not available (it may belong to another workspace).';
    default:
      return 'Try again shortly.';
  }
}

export function LensDatasetsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Datasets'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  // Create is a centered modal (AppModal), consistent with the rest of the dashboard — replaces the
  // former inline Card form (Evaluate UX standardization: forms open as centered modals, never inline/lateral).
  const [createOpen, setCreateOpen] = useState(false);
  // M70 — the open items-panel is URL-state (`?dataset=`), so it is shareable + browser-Back-closable
  // (the useQueryState/nuqs pattern the Traces page uses). `null` clears the param.
  const [openID, setOpenID] = useQueryState('dataset', parseAsString);
  const [peekTrace, setPeekTrace] = useState<string | null>(null); // dataset item → source-span peek (M70)
  const [pendingRemove, setPendingRemove] = useState<{ datasetID: string; traceId: string } | null>(null);
  // M82 list-management state: which dataset is being renamed inline (+ its draft), and a pending delete.
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Dataset | null>(null);

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/datasets'] as const,
    queryFn: () => cloudFetch<DatasetsResult>('/v1/dashboard/lens/datasets', {}, { throwOnError: true }),
  });

  const detail = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/datasets', openID] as const,
    // throwOnError so a failed detail load REJECTS (detail.isError) instead of resolving to null —
    // otherwise a load error is indistinguishable from an empty dataset and renders as "No items".
    queryFn: () => cloudFetch<DatasetDetail>(`/v1/dashboard/lens/datasets/${encodeURIComponent(openID as string)}`, {}, { throwOnError: true }),
    enabled: openID !== null,
    retry: false,
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/datasets'] });

  const create = useMutation({
    mutationFn: (n: string) =>
      cloudFetch<Dataset>('/v1/dashboard/lens/datasets', {
        method: 'POST',
        body: JSON.stringify({ name: n }),
      }),
    onSuccess: () => {
      setName('');
      setCreateOpen(false);
      invalidate();
    },
  });

  const removeItem = useMutation({
    mutationFn: (r: { datasetID: string; traceId: string }) =>
      cloudFetch<DatasetDetail>(
        `/v1/dashboard/lens/datasets/${encodeURIComponent(r.datasetID)}/items/${encodeURIComponent(r.traceId)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      setPendingRemove(null);
      void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/datasets', openID] });
      invalidate();
    },
  });

  // M82 — rename a dataset (PUT {name}). throwOnError so a 409 rejects and surfaces the typed Alert.
  const rename = useMutation({
    mutationFn: (r: { id: string; name: string }) =>
      cloudFetch<Dataset>(
        `/v1/dashboard/lens/datasets/${encodeURIComponent(r.id)}`,
        { method: 'PUT', body: JSON.stringify({ name: r.name }) },
        { throwOnError: true },
      ),
    retry: false,
    onSuccess: () => {
      setRenaming(null);
      invalidate();
    },
  });

  // M82 — delete a dataset (cascades runs+items in theo-lens).
  const remove = useMutation({
    mutationFn: (id: string) =>
      cloudFetch<void>(`/v1/dashboard/lens/datasets/${encodeURIComponent(id)}`, { method: 'DELETE' }, { throwOnError: true }),
    retry: false,
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
    },
  });

  const commitRename = () => {
    if (!renaming) return;
    const row = (query.data?.datasets ?? []).find((d) => d.id === renaming.id);
    const name = renaming.value.trim();
    if (!row || name.length === 0 || name === row.name) {
      setRenaming(null);
      return;
    }
    rename.mutate({ id: row.id, name });
  };

  const columns: DataTableColumn<Dataset>[] = [
    {
      key: 'name',
      label: 'Name',
      render: (row) =>
        renaming?.id === row.id ? (
          <Input
            autoFocus
            aria-label={`Rename dataset ${row.name}`}
            value={renaming.value}
            onChange={(e) => setRenaming({ id: row.id, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setRenaming(null);
            }}
            onBlur={commitRename}
            className="max-w-[220px]"
          />
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setOpenID(row.id)} aria-label={`Open ${row.name}`}>
            {row.name}
          </Button>
        ),
    },
    // An absent count is unknown → em-dash; a real 0 stays 0 (an empty-but-loaded dataset).
    { key: 'itemCount', label: 'Items', render: (row) => <span>{row.itemCount != null ? row.itemCount : '—'}</span> },
    {
      key: 'createdAt',
      label: 'Created',
      render: (row) => (row.createdAt ? <Timestamp value={row.createdAt} /> : <span>—</span>),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      // Wire the eval loop (Run experiment) + M82 list management (Rename / Delete).
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link to={`/observability/experiments?datasetId=${encodeURIComponent(row.id)}`}>Run experiment</Link>
          </Button>
          <Button variant="ghost" size="sm" aria-label={`Rename ${row.name}`} onClick={() => setRenaming({ id: row.id, value: row.name })}>
            Rename
          </Button>
          {/* preventDefault on mousedown keeps focus in the rename Input (no blur-commit); the
              onClick then cancels any in-progress rename and opens the delete dialog. */}
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Delete dataset ${row.name}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setRenaming(null);
              setPendingDelete(row);
            }}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  // Managed dataset-item rows (traceId + remove action) rendered via DataTable (M46 — mirrors
  // rag/collections; managed rows with a mutation use DataTable, not a native list). `datasetID` is
  // the open dataset (non-null while the items panel is shown).
  const itemColumns = (datasetID: string): DataTableColumn<DatasetItem>[] => [
    { key: 'traceId', label: 'Trace', render: (row) => <span className="font-mono text-sm">{row.traceId}</span> },
    {
      key: 'view',
      label: '',
      // Wire the eval loop: a dataset item opens its source trace's span peek (M58), no dead-end.
      render: (row) => (
        <Button variant="ghost" size="sm" onClick={() => setPeekTrace(row.traceId)}>
          View trace
        </Button>
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPendingRemove({ datasetID, traceId: row.traceId })}
          aria-label={`Remove ${row.traceId}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const datasets = query.data?.datasets ?? [];

  return (
    <>
      <PageShell
        title="Datasets"
        description="Curate trace datasets for evaluation."
        primaryAction={{ label: 'New dataset', icon: Plus, onClick: () => setCreateOpen(true) }}
      >
        <div className="space-y-6">
          {query.isLoading ? (
            <ListSkeleton label="datasets" />
          ) : query.isError ? (
            <Alert intent="warning" title="Could not load datasets">
              The lens service is unavailable. Try again shortly.
            </Alert>
          ) : datasets.length === 0 ? (
            <EmptyState
              title="No datasets yet"
              description="Create your first dataset to start curating traces."
              action={
                <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
                  Name your first dataset
                </Button>
              }
            />
          ) : (
            <Card>
              <DataTable columns={columns} data={datasets} rowKey={(row) => row.id} />
            </Card>
          )}

          {rename.isError ? (
            <Alert intent="warning" title="Could not rename the dataset" description={writeErrorMessage(rename.error)} data-testid="rename-error" />
          ) : null}
          {remove.isError ? (
            <Alert intent="warning" title="Could not delete the dataset" description={writeErrorMessage(remove.error)} data-testid="delete-error" />
          ) : null}

          {openID !== null ? (
            <Card>
              <Card.Header>
                <h2 className="text-sm font-medium">Items</h2>
                <Button variant="ghost" size="sm" onClick={() => setOpenID(null)} aria-label="Close items">
                  Close
                </Button>
              </Card.Header>
              <Card.Body>
                {detail.isLoading ? (
                  <ListSkeleton label="dataset items" rows={3} />
                ) : detail.isError ? (
                  <Alert intent="destructive" title="Could not load items" description="The dataset items failed to load. Retry, or check your access to this dataset." />
                ) : (detail.data?.items ?? []).length === 0 ? (
                  <EmptyState title="No items" description="Add traces to this dataset from the Traces page." />
                ) : (
                  <DataTable
                    columns={itemColumns(openID)}
                    data={detail.data?.items ?? []}
                    rowKey={(row) => row.traceId}
                  />
                )}
              </Card.Body>
            </Card>
          ) : null}
        </div>
      </PageShell>

      <AppModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setName('');
          create.reset();
        }}
        size="sm"
        title="New dataset"
        description="Curate a set of traces to evaluate together."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setCreateOpen(false);
                setName('');
                create.reset();
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => name.trim() && create.mutate(name.trim())} disabled={!name.trim() || create.isPending}>
              {create.isPending ? 'Creating…' : 'Create dataset'}
            </Button>
          </>
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="dataset-name">Dataset name</Label>
          <Input
            id="dataset-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) create.mutate(name.trim());
            }}
            placeholder="New dataset name"
          />
          {create.isError ? (
            <p className="text-xs text-destructive">Could not create the dataset. Try again shortly.</p>
          ) : null}
        </div>
      </AppModal>

      {pendingRemove ? (
        <ConfirmDialog
          open={pendingRemove !== null}
          onOpenChange={(o) => !o && setPendingRemove(null)}
          title={`Remove ${pendingRemove.traceId} from the dataset?`}
          description={<p className="text-sm">This removes the trace from this dataset. This cannot be undone.</p>}
          confirmLabel={removeItem.isPending ? 'Removing…' : 'Remove item'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={removeItem.isPending}
          onConfirm={() => removeItem.mutate(pendingRemove)}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          title={`Delete “${pendingDelete.name}”?`}
          description={<p className="text-sm">This permanently deletes the dataset, its items, and any experiment runs on it. This cannot be undone.</p>}
          confirmLabel={remove.isPending ? 'Deleting…' : 'Delete dataset'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={remove.isPending}
          onConfirm={() => remove.mutate(pendingDelete.id)}
        />
      ) : null}

      <TracePeekSheet traceId={peekTrace} onClose={() => setPeekTrace(null)} />
    </>
  );
}
