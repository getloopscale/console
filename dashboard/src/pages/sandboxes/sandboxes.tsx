import { useState } from 'react';
import { Box, Trash2 } from 'lucide-react';
import { Badge, Button, Card, Table } from '@getloopscale/ui';
import { PageShell } from '@/components/ui/page-shell';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import {
  useSandboxes,
  useTerminateSandbox,
  type SandboxRow,
} from '@/hooks/sandboxes/use-sandboxes';
import { formatDate } from '@/lib/formatting/format';
import { estadoDaLista } from '@/lib/list-state';

const STATE_VARIANTS: Record<string, 'default' | 'success' | 'warning'> = {
  running: 'success',
  paused: 'warning',
  pending: 'default',
};

/** A sandbox reaches the public internet unless it was created with outbound rules. */
function outboundNetwork(sandbox: SandboxRow): string {
  const rules = sandbox.network;
  const restricted = (rules?.allow_out?.length ?? 0) > 0 || (rules?.deny_out?.length ?? 0) > 0;
  return restricted ? 'Restricted' : 'Open internet';
}

export function SandboxesPage() {
  useRequireAuth();
  const { setPageTitle } = usePageMeta();

  const sandboxesQuery = useSandboxes();
  const loading = sandboxesQuery.isLoading;
  const sandboxes = sandboxesQuery.data?.sandboxes ?? [];
  const terminate = useTerminateSandbox();
  const [terminateTarget, setTerminateTarget] = useState<string | null>(null);

  return (
    <PageShell
      title="Sandboxes"
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
      <Card>
        <Card.Body className="p-0">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Sandbox</Table.HeaderCell>
                <Table.HeaderCell>Image</Table.HeaderCell>
                <Table.HeaderCell>State</Table.HeaderCell>
                <Table.HeaderCell>Outbound network</Table.HeaderCell>
                <Table.HeaderCell>Created</Table.HeaderCell>
                <Table.HeaderCell>Expires</Table.HeaderCell>
                <Table.HeaderCell align="right">
                  <span className="sr-only">Actions</span>
                </Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {sandboxes.map((sandbox) => (
                <Table.Row key={sandbox.id}>
                  <Table.Cell>
                    <span className="font-mono text-label text-foreground">{sandbox.id}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="font-mono text-label text-muted-foreground">
                      {sandbox.image ?? '—'}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge variant={STATE_VARIANTS[sandbox.state] ?? 'default'}>
                      {sandbox.state}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="text-body-sm text-foreground">{outboundNetwork(sandbox)}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="text-label text-muted-foreground tabular-nums">
                      {formatDate(sandbox.created_at, 'datetime')}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="text-label text-muted-foreground tabular-nums">
                      {formatDate(sandbox.expires_at, 'datetime')}
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
