import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Box, Trash2 } from 'lucide-react';
import { Badge, Button, Card, Input, Table } from '@getloopscale/ui';
import { PageShell } from '@/components/ui/page-shell';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { useNow } from '@/hooks/deploy/use-clock-tick';
import {
  SANDBOXES_REFETCH_MS,
  useSandboxes,
  useTerminateSandbox,
} from '@/hooks/sandboxes/use-sandboxes';
import { formatDate } from '@/lib/formatting/format';
import { estadoDaLista } from '@/lib/list-state';
import {
  countByState,
  metadataPairs,
  runningFor,
  visibleSandboxes,
  type SandboxStateFilter,
  type StartOrder,
} from './list-view';
import { outboundNetwork, STATE_VARIANTS } from './sandbox-labels';
import { SandboxSections } from './sandbox-sections';
import { Segmented } from './segmented';

/** The choices of the auto-refresh control, as the interval in ms or "off". */
const REFRESH_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: '5000', label: '5s' },
  { value: String(SANDBOXES_REFETCH_MS), label: '10s' },
  { value: '30000', label: '30s' },
];

export function SandboxesPage() {
  useRequireAuth();
  const { setPageTitle } = usePageMeta();

  const [refresh, setRefresh] = useState(String(SANDBOXES_REFETCH_MS));
  const sandboxesQuery = useSandboxes(refresh === 'off' ? false : Number(refresh));
  const loading = sandboxesQuery.isLoading;
  const sandboxes = sandboxesQuery.data?.sandboxes ?? [];
  const [search, setSearch] = useState('');
  const [state, setState] = useState<SandboxStateFilter>('all');
  const [order, setOrder] = useState<StartOrder>('newest');
  const now = useNow(1000);
  const counts = countByState(sandboxes);
  const visible = visibleSandboxes([...sandboxes], { search, state, order });
  const terminate = useTerminateSandbox();
  const [terminateTarget, setTerminateTarget] = useState<string | null>(null);

  return (
    <PageShell
      title="Sandboxes"
      description={<SandboxSections />}
      onTitleChange={setPageTitle}
      loading={loading}
      empty={estadoDaLista(
        {
          failure: sandboxesQuery.isError,
          empty:
            !loading && sandboxes.length === 0
              ? {
                  icon: Box,
                  title: 'No sandboxes running',
                  description:
                    'Create one with the loopsandbox SDK or `lsb sandbox create`, using an API token with the sandbox:execute scope. It appears here while it runs.',
                }
              : undefined,
        },
        'sandboxes',
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by sandbox ID"
          aria-label="Search by sandbox ID"
          className="w-64"
        />
        <Segmented
          label="State"
          value={state}
          onChange={setState}
          options={[
            { value: 'all', label: `All ${counts.all}` },
            { value: 'running', label: `Running ${counts.running}` },
            { value: 'paused', label: `Paused ${counts.paused}` },
            { value: 'pending', label: `Pending ${counts.pending}` },
          ]}
        />
        <span className="text-label text-muted-foreground" data-testid="concurrent-sandboxes">
          <span className="font-medium text-foreground tabular-nums">{counts.all}</span> concurrent{' '}
          {counts.all === 1 ? 'sandbox' : 'sandboxes'}
        </span>
        <span className="ml-auto flex items-center gap-2 text-label text-muted-foreground">
          Auto-refresh
          <Segmented label="Auto-refresh" value={refresh} onChange={setRefresh} options={REFRESH_OPTIONS} />
        </span>
      </div>

      <Card>
        <Card.Body className="p-0">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell aria-sort={order === 'newest' ? 'descending' : 'ascending'}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1"
                    onClick={() => setOrder(order === 'newest' ? 'oldest' : 'newest')}
                    aria-label={`Started, ${order} first. Reverse the order`}
                  >
                    Started
                    {order === 'newest' ? (
                      <ArrowDown className="size-3" aria-hidden="true" />
                    ) : (
                      <ArrowUp className="size-3" aria-hidden="true" />
                    )}
                  </button>
                </Table.HeaderCell>
                <Table.HeaderCell>Sandbox</Table.HeaderCell>
                <Table.HeaderCell>State</Table.HeaderCell>
                <Table.HeaderCell>Image</Table.HeaderCell>
                <Table.HeaderCell>Running for</Table.HeaderCell>
                <Table.HeaderCell>Outbound network</Table.HeaderCell>
                <Table.HeaderCell>Metadata</Table.HeaderCell>
                <Table.HeaderCell align="right">
                  <span className="sr-only">Actions</span>
                </Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {visible.length === 0 && (
                <Table.Row>
                  <Table.Cell colSpan={8}>
                    <span className="text-body-sm text-muted-foreground">
                      No sandbox matches the search and the state chosen.
                    </span>
                  </Table.Cell>
                </Table.Row>
              )}
              {visible.map((sandbox) => (
                <Table.Row key={sandbox.id}>
                  <Table.Cell>
                    <span className="text-label text-muted-foreground tabular-nums">
                      {formatDate(sandbox.created_at, 'datetime')}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <Link
                      to={`/sandboxes/${encodeURIComponent(sandbox.id)}`}
                      className="font-mono text-label text-foreground underline-offset-2 hover:underline"
                    >
                      {sandbox.id}
                    </Link>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge variant={STATE_VARIANTS[sandbox.state] ?? 'default'}>
                      {sandbox.state}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="font-mono text-label text-muted-foreground">
                      {sandbox.image ?? '—'}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="text-label text-foreground tabular-nums">
                      {runningFor(sandbox.created_at, now)}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="text-body-sm text-foreground">{outboundNetwork(sandbox.network)}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="font-mono text-label text-muted-foreground">
                      {metadataPairs(sandbox.metadata).join(' ') || '—'}
                    </span>
                  </Table.Cell>
                  <Table.Cell align="right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setTerminateTarget(sandbox.id)}
                      aria-label={`Terminate ${sandbox.id}`}
                    >
                      <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Card.Body>
      </Card>

      <ConfirmDialog
        open={terminateTarget !== null}
        onOpenChange={(open) => !open && setTerminateTarget(null)}
        title={`Terminate ${terminateTarget ?? ''}?`}
        description="Its processes stop and its files are deleted. This cannot be undone."
        confirmLabel="Terminate sandbox"
        cancelLabel="Cancel"
        intent="destructive"
        loading={terminate.isPending}
        onConfirm={() => {
          if (terminateTarget) {
            terminate.mutate(terminateTarget, { onSettled: () => setTerminateTarget(null) });
          }
        }}
      />
    </PageShell>
  );
}
