import { type ChangeEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug, RefreshCw, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  Label,
  PageShell,
  Select,
  Skeleton,
  Timestamp,
} from '@usetheo/ui';
import { AppModal } from '@/components/ui/app-modal';
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

// Human messages for the broker's ?connect_error=<reason> redirect (rag_connectors_oauth.go). An
// unmapped reason still shows a sane generic message rather than the raw token.
const CONNECT_ERROR_MESSAGES: Record<string, string> = {
  unknown_provider: 'That provider isn’t available to connect. Pick one from the list.',
  missing_collection: 'Pick a collection before connecting a source.',
  state_mismatch: 'The connection link expired or didn’t match. Please try again.',
  context_expired: 'The connection window timed out. Please try again.',
  provider_exchange_failed: 'The provider rejected the connection. Please try again.',
  connect_failed: 'We authorized the provider but couldn’t finish connecting the source. Please try again.',
  internal: 'Something went wrong starting the connection. Please try again.',
};

function connectErrorMessage(reason: string): string {
  return CONNECT_ERROR_MESSAGES[reason] ?? 'The connection didn’t complete. Please try again.';
}

// M12 — paste-credential (non-OAuth) providers + their fields, mirroring theo-rag's
// per-provider connect contract. `secret: true` masks the input; `optional: true` fields
// may be blank. Adding a provider here is the only change needed to expose it.
interface CredField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  optional?: boolean;
}
const CRED_PROVIDERS: Record<string, { label: string; fields: CredField[] } | undefined> = {
  s3: {
    label: 'Amazon S3',
    fields: [
      { key: 'access_key_id', label: 'Access key ID', placeholder: 'AKIA…' },
      { key: 'secret_access_key', label: 'Secret access key', secret: true },
      { key: 'region', label: 'Region', placeholder: 'us-east-1' },
      { key: 'bucket', label: 'Bucket', placeholder: 'my-docs-bucket' },
      { key: 'prefix', label: 'Prefix (optional)', placeholder: 'reports/', optional: true },
    ],
  },
  web: {
    label: 'Website',
    fields: [
      { key: 'seed_url', label: 'Start URL', placeholder: 'https://docs.example.com' },
      { key: 'max_pages', label: 'Max pages (optional)', placeholder: '50', optional: true },
    ],
  },
};

// A top-level navigation (not fetch): the browser must follow the redirect chain to the provider
// consent and back, carrying the Kratos session cookie. The broker lives at the BFF origin's root
// path /v1/rag-connect (cookie-session auth, #199) — NOT the Bearer /v1/dashboard/rag surface.
function authorizeHref(provider: string, collectionID: string): string {
  return `${getApiBase()}/v1/rag-connect/${encodeURIComponent(provider)}/authorize?collection_id=${encodeURIComponent(collectionID)}`;
}

export function RagConnectorsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('RAG · Connectors'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [pendingDelete, setPendingDelete] = useState<Connection | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [collectionID, setCollectionID] = useState('');
  // M12 — paste-credential (non-OAuth) connect. Provider '' hides the form; picking S3/Web
  // reveals its fields. Fields are a flat string map; the credential is POSTed opaquely.
  const [credProvider, setCredProvider] = useState('');
  const [credFields, setCredFields] = useState<Record<string, string>>({});
  const setCredField = (k: string) => (e: ChangeEvent<HTMLInputElement>) =>
    setCredFields((f) => ({ ...f, [k]: e.target.value }));

  // Banners after the OAuth broker redirects back: ?connected=<provider> (success) or
  // ?connect_error=<reason> (failure). Read once, then strip the query params so a refresh doesn't re-show.
  const [connected] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('connected'),
  );
  const [connectError] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('connect_error'),
  );
  useEffect(() => {
    if ((!connected && !connectError) || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('connected');
    url.searchParams.delete('connect_error');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }, [connected, connectError]);

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

  // M12 — connect a paste-credential (non-OAuth) source. The BFF proxies the body opaquely to
  // theo-rag's POST /v1/connectors/{provider}/connect (credential encrypted at rest; never logged).
  const connectCredential = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = { collection_id: collectionID };
      for (const f of CRED_PROVIDERS[credProvider]?.fields ?? []) {
        const v = credFields[f.key]?.trim() ?? '';
        if (v !== '') body[f.key] = v;
      }
      return cloudFetch<{ id: string }>(
        `/v1/dashboard/rag/connectors/${encodeURIComponent(credProvider)}/connect`,
        { method: 'POST', body: JSON.stringify(body) },
      );
    },
    onSuccess: () => {
      setCredProvider('');
      setCredFields({});
      setAddOpen(false);
      invalidate();
    },
  });

  const credSpec = CRED_PROVIDERS[credProvider];
  const credComplete =
    collectionID !== '' &&
    credSpec !== undefined &&
    credSpec.fields.every((f) => f.optional || (credFields[f.key]?.trim() ?? '') !== '');

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
          {connectError ? (
            <Alert intent="destructive" title="Could not connect the source">
              {connectErrorMessage(connectError)}
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
              description="Use “Connect a source” to authorize an OAuth provider, or connect a paste-credential source (S3, website) right here."
            />
          ) : (
            <Card>
              <DataTable columns={columns} data={items} rowKey={(row) => row.id} />
            </Card>
          )}
        </div>
      </PageShell>

      <AppModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Connect a source"
        description="Pick the collection to ingest into, then authorize the provider. You’ll be redirected to grant access, then back here."
        footer={
          <Button variant="secondary" onClick={() => setAddOpen(false)}>
            Close
          </Button>
        }
      >
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
                    No OAuth providers are configured yet. Use the “or connect with a credential” form below to connect an S3 bucket or a website — no OAuth needed.
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

              {/* M12 — paste-credential (non-OAuth) connect: S3 / Website. */}
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or connect with a credential</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="space-y-3">
                <Select value={credProvider} onValueChange={(v) => { setCredProvider(v); setCredFields({}); }}>
                  <Select.Trigger className="w-full" aria-label="Credential provider">
                    <Select.Value placeholder="Pick a source (S3, website…)" />
                  </Select.Trigger>
                  <Select.Content>
                    {Object.entries(CRED_PROVIDERS).map(([key, spec]) => (
                      <Select.Item key={key} value={key}>
                        {spec?.label ?? key}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
                {credSpec ? (
                  <div className="space-y-2">
                    {credSpec.fields.map((f) => (
                      <div key={f.key} className="space-y-1">
                        <Label htmlFor={`cred-${f.key}`}>{f.label}</Label>
                        <Input
                          id={`cred-${f.key}`}
                          type={f.secret ? 'password' : 'text'}
                          autoComplete={f.secret ? 'new-password' : 'off'}
                          placeholder={f.placeholder}
                          value={credFields[f.key] ?? ''}
                          onChange={setCredField(f.key)}
                          aria-label={f.label}
                        />
                      </div>
                    ))}
                    <div className="flex justify-end pt-1">
                      <Button disabled={!credComplete || connectCredential.isPending} onClick={() => connectCredential.mutate()}>
                        {connectCredential.isPending ? 'Connecting…' : `Connect ${credSpec.label}`}
                      </Button>
                    </div>
                    {!collectionID ? (
                      <p className="text-xs text-muted-foreground">Select a collection above first.</p>
                    ) : null}
                    {connectCredential.isError ? (
                      <Alert intent="destructive" title="Could not connect the source">
                        Check the credentials and try again.
                      </Alert>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
      </AppModal>

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
