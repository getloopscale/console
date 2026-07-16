import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug, RefreshCw, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  Dialog,
  EmptyState,
  Label,
  PageShell,
  Select,
  Skeleton,
  Timestamp,
} from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch, getApiBase } from '@/lib/api';

/**
 * #191 + M8 — /rag/connectors. See and manage the workspace's connector connections (list +
 * sync + delete) via the read+write dashboard BFF, AND connect a NEW OAuth source without ever
 * hand-crafting a refresh_token: "Connect a source" → pick a collection → "Connect with X" runs
 * a top-level navigation to the BFF OAuth broker (`GET .../connectors/{provider}/authorize`), which
 * drives the consent → callback → code→refresh_token → connect dance and redirects back here with
 * `?connected={provider}`. Only OAuth providers the operator has actually registered are offered
 * (`GET .../connectors/providers`), so a "Connect with X" button never dead-ends on a 422.
 */

interface Connection {
  id: string;
  provider_id: string;
  collection_id: string;
  status: string;
  created_at?: string;
}

interface ConnectionsResult {
  items: Connection[];
}

interface CollectionsResult {
  items: { id: string; name: string }[];
}

interface OAuthProvidersResult {
  providers: string[];
}

// Human labels for the OAuth-refresh providers the broker knows. Fallback title-cases the slug so
// a provider added server-side still renders sensibly before this map is updated.
const OAUTH_PROVIDER_LABELS: Record<string, string> = {
  'google-drive': 'Google Drive',
  gmail: 'Gmail',
  dropbox: 'Dropbox',
  box: 'Box',
  'microsoft-365': 'Microsoft 365',
  salesforce: 'Salesforce',
  confluence: 'Confluence',
  jira: 'Jira',
};

function providerLabel(provider: string): string {
  return OAUTH_PROVIDER_LABELS[provider] ?? provider.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// A top-level navigation (not fetch): the browser must follow the redirect chain to the provider
// consent and back, carrying the session cookie. The BFF origin (getApiBase) serves the broker.
function authorizeHref(provider: string, collectionID: string): string {
  return `${getApiBase()}/v1/dashboard/rag/connectors/${encodeURIComponent(provider)}/authorize?collection_id=${encodeURIComponent(collectionID)}`;
}

export function RagConnectorsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('RAG · Connectors'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [pendingDelete, setPendingDelete] = useState<Connection | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [collectionID, setCollectionID] = useState('');

  // Success banner after the OAuth broker redirects back (?connected=<provider>). Read once, then
  // strip the query param so a refresh does not re-show it.
  const [connected] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('connected'),
  );
  useEffect(() => {
    if (!connected || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('connected');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }, [connected]);

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/connectors'] as const,
    queryFn: () => cloudFetch<ConnectionsResult>('/v1/dashboard/rag/connectors'),
  });
  const providersQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/connectors/providers'] as const,
    queryFn: () => cloudFetch<OAuthProvidersResult>('/v1/dashboard/rag/connectors/providers'),
  });
  const collectionsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/collections'] as const,
    queryFn: () => cloudFetch<CollectionsResult>('/v1/dashboard/rag/collections'),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/rag/connectors'] });

  const sync = useMutation({
    mutationFn: (c: Connection) =>
      cloudFetch<unknown>(`/v1/dashboard/rag/connectors/${encodeURIComponent(c.id)}/sync`, {
        method: 'POST',
      }),
    onSuccess: () => invalidate(),
  });

  const remove = useMutation({
    mutationFn: (c: Connection) =>
      cloudFetch<null>(`/v1/dashboard/rag/connectors/${encodeURIComponent(c.id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
    },
  });

  const columns: DataTableColumn<Connection>[] = [
    { key: 'provider_id', label: 'Provider', render: (row) => <span className="capitalize">{row.provider_id}</span> },
    { key: 'collection_id', label: 'Collection', render: (row) => <span className="font-mono text-sm">{row.collection_id}</span> },
    { key: 'status', label: 'Status', render: (row) => <span className="capitalize">{row.status}</span> },
    {
      key: 'created_at',
      label: 'Created',
      render: (row) => (row.created_at ? <Timestamp value={row.created_at} /> : <span>—</span>),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => sync.mutate(row)}
            disabled={sync.isPending}
            aria-label={`Sync ${row.id}`}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPendingDelete(row)} aria-label={`Delete ${row.id}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const items = query.data?.items ?? [];
  const oauthProviders = providersQuery.data?.providers ?? [];
  const collections = collectionsQuery.data?.items ?? [];

  return (
    <>
      <PageShell title="Connectors" description="Sync and manage the data-source connections that ingest into your collections.">
        <div className="space-y-6">
          {connected ? (
            <Alert intent="success" title={`Connected ${providerLabel(connected)}`}>
              The source is authorized. Its first sync will start shortly.
            </Alert>
          ) : null}
          {sync.isError ? (
            <Alert intent="destructive" title="Could not start the sync">
              Try again shortly.
            </Alert>
          ) : null}
          {remove.isError ? (
            <Alert intent="destructive" title="Could not delete the connector">
              A sync may be in progress — try again shortly.
            </Alert>
          ) : null}

          <div className="flex items-center justify-end">
            <Button onClick={() => setAddOpen(true)}>
              <Plug className="mr-1.5 h-4 w-4" />
              Connect a source
            </Button>
          </div>

          {query.isLoading ? (
            <Skeleton />
          ) : query.isError ? (
            <Alert intent="warning" title="Could not load connectors">
              The RAG service is unavailable. Try again shortly.
            </Alert>
          ) : items.length === 0 ? (
            <EmptyState
              title="No connectors yet"
              description="Use “Connect a source” to authorize an OAuth provider, or connect a paste-credential source with the CLI (POST /v1/connectors/{provider}/connect). More coming soon."
            />
          ) : (
            <Card>
              <DataTable columns={columns} data={items} rowKey={(row) => row.id} />
            </Card>
          )}
        </div>
      </PageShell>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Connect a source</Dialog.Title>
            <Dialog.Description>
              Pick the collection to ingest into, then authorize the provider. You’ll be redirected to grant access, then back here.
            </Dialog.Description>
          </Dialog.Header>
          <Dialog.Body>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="connect-collection">Collection</Label>
                <Select value={collectionID} onValueChange={setCollectionID}>
                  <Select.Trigger id="connect-collection" className="w-full" aria-label="Collection">
                    <Select.Value placeholder="Select a collection…" />
                  </Select.Trigger>
                  <Select.Content>
                    {collections.map((c) => (
                      <Select.Item key={c.id} value={c.id}>
                        {c.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Provider</Label>
                {oauthProviders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No OAuth providers are configured yet. Connect a paste-credential source (e.g. S3, web, Slack) with the CLI.
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {oauthProviders.map((p) =>
                      collectionID ? (
                        <Button key={p} asChild variant="secondary" className="justify-start">
                          <a href={authorizeHref(p, collectionID)}>Connect with {providerLabel(p)}</a>
                        </Button>
                      ) : (
                        <Button
                          key={p}
                          variant="secondary"
                          className="justify-start"
                          disabled
                          aria-label={`Connect with ${providerLabel(p)}`}
                        >
                          Connect with {providerLabel(p)}
                        </Button>
                      ),
                    )}
                  </div>
                )}
                {!collectionID && oauthProviders.length > 0 ? (
                  <p className="text-xs text-muted-foreground">Select a collection to enable the providers.</p>
                ) : null}
              </div>
            </div>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              Close
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      {pendingDelete ? (
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          title={`Delete the ${providerLabel(pendingDelete.provider_id)} connector?`}
          description={
            <p className="text-sm">
              This removes the connection and its credentials. Already-ingested documents are kept. This cannot be undone.
            </p>
          }
          confirmLabel={remove.isPending ? 'Deleting…' : 'Delete connector'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={remove.isPending}
          onConfirm={() => remove.mutate(pendingDelete)}
        />
      ) : null}
    </>
  );
}
