import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pause, Play, Trash2 } from 'lucide-react';
import { Badge, Button, Card, Table, Tabs, Textarea } from '@getloopscale/ui';
import { PageShell } from '@/components/ui/page-shell';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { useNow } from '@/hooks/deploy/use-clock-tick';
import {
  useSandbox,
  useSandboxLogs,
  useSandboxNetworkDenials,
  useSandboxTransition,
  useTerminateSandbox,
  useUpdateSandboxNetwork,
  type SandboxRow,
} from '@/hooks/sandboxes/use-sandboxes';
import { formatDate } from '@/lib/formatting/format';
import { expiresIn, metadataPairs, ruleLines, runningFor } from './list-view';
import { FilesTab } from './files-tab';
import { MonitoringTab } from './monitoring-tab';
import { TerminalTab } from './terminal-tab';
import { outboundNetwork, sandboxFailure, STATE_VARIANTS } from './sandbox-labels';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-body-sm text-foreground">{children}</dd>
    </div>
  );
}

function NetworkTab({ sandbox }: { sandbox: SandboxRow }) {
  const update = useUpdateSandboxNetwork(sandbox.id);
  const denials = useSandboxNetworkDenials(sandbox.id);
  const [allow, setAllow] = useState((sandbox.network?.allow_out ?? []).join('\n'));
  const [deny, setDeny] = useState((sandbox.network?.deny_out ?? []).join('\n'));
  const refused = denials.data?.denials ?? [];

  return (
    <div className="space-y-6 pt-4">
      <Card>
        <Card.Body className="space-y-4">
          <p className="text-body-sm text-muted-foreground">
            With no rules the sandbox reaches the public internet. An allowed destination wins over a
            denied one, so the usual restriction is to deny <code className="font-mono">0.0.0.0/0</code> and
            allow the hosts the code needs. Private addresses and cloud metadata are always refused. The
            rules apply to the next connections, with the sandbox running.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-label text-foreground">Allowed destinations</span>
              <Textarea
                aria-label="Allowed destinations"
                rows={5}
                className="font-mono"
                value={allow}
                placeholder={'pypi.org\n*.pythonhosted.org'}
                onChange={(e) => setAllow(e.target.value)}
              />
              <span className="text-label text-muted-foreground">
                One per line: address, CIDR range, host name or *.name.
              </span>
            </label>
            <label className="block space-y-1">
              <span className="text-label text-foreground">Denied destinations</span>
              <Textarea
                aria-label="Denied destinations"
                rows={5}
                className="font-mono"
                value={deny}
                placeholder="0.0.0.0/0"
                onChange={(e) => setDeny(e.target.value)}
              />
              <span className="text-label text-muted-foreground">One per line: address or CIDR range.</span>
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={update.isPending}
              onClick={() => update.mutate({ allow_out: ruleLines(allow), deny_out: ruleLines(deny) })}
            >
              Apply rules
            </Button>
            {update.isSuccess && <span className="text-label text-muted-foreground">Rules applied.</span>}
            {update.isError && (
              <span role="alert" className="text-label text-destructive">
                {sandboxFailure(update.error)}
              </span>
            )}
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>Refused connections</Card.Title>
        </Card.Header>
        <Card.Body className="p-0">
          {denials.isError ? (
            <p role="alert" className="p-4 text-body-sm text-destructive">
              Could not read the refused connections: {sandboxFailure(denials.error)}
            </p>
          ) : refused.length === 0 ? (
            <p className="p-4 text-body-sm text-muted-foreground">
              No connection was refused. A refusal appears here a few seconds after it happens.
            </p>
          ) : (
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Time</Table.HeaderCell>
                  <Table.HeaderCell>Host</Table.HeaderCell>
                  <Table.HeaderCell>Destination</Table.HeaderCell>
                  <Table.HeaderCell>Reason</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {refused.map((denial) => (
                  <Table.Row key={`${denial.time} ${denial.destination}`}>
                    <Table.Cell>
                      <span className="text-label text-muted-foreground tabular-nums">
                        {formatDate(denial.time, 'datetime')}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="font-mono text-label text-foreground">{denial.host ?? '—'}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="font-mono text-label text-muted-foreground">{denial.destination}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-body-sm text-foreground">{denial.reason}</span>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}

function LogsTab({ id, active }: { id: string; active: boolean }) {
  const logs = useSandboxLogs(id, active);
  const entries = logs.data?.entries ?? [];

  return (
    <div className="pt-4">
      <Card>
        <Card.Body className="p-0">
          {logs.isError ? (
            <p role="alert" className="p-4 text-body-sm text-destructive">
              Could not read the logs: {sandboxFailure(logs.error)}
            </p>
          ) : entries.length === 0 ? (
            <p className="p-4 text-body-sm text-muted-foreground">
              No output yet. The output of the background processes of the sandbox appears here.
            </p>
          ) : (
            <pre className="max-h-[32rem] overflow-auto p-4 font-mono text-label leading-relaxed">
              {logs.data?.truncated && (
                <span className="text-muted-foreground">The oldest output was dropped.{'\n'}</span>
              )}
              {entries.map((entry, index) => (
                <span
                  key={`${entry.at} ${entry.pid} ${index}`}
                  className={entry.stream === 'stderr' ? 'text-destructive' : 'text-foreground'}
                >
                  {entry.data}
                </span>
              ))}
            </pre>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}

export function SandboxDetailPage() {
  useRequireAuth();
  const { id = '' } = useParams<{ id: string }>();
  const { setPageTitle } = usePageMeta();
  const navigate = useNavigate();
  const now = useNow(1000);

  const query = useSandbox(id);
  const sandbox = query.data;
  const pause = useSandboxTransition(id, 'pause');
  const resume = useSandboxTransition(id, 'resume');
  const kill = useTerminateSandbox();
  const [confirmKill, setConfirmKill] = useState(false);
  const [tab, setTab] = useState('network');
  const failure = pause.error ?? resume.error ?? kill.error;

  const back = (
    <Link
      to="/sandboxes"
      className="inline-flex items-center gap-1 text-label text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3" aria-hidden="true" />
      Back to sandboxes
    </Link>
  );

  return (
    <PageShell title={id} onTitleChange={setPageTitle} loading={query.isLoading}>
      {!sandbox ? (
        <Card>
          <Card.Body className="space-y-2">
            <p className="text-body font-medium text-foreground">Sandbox not found</p>
            <p className="text-body-sm text-muted-foreground">
              It was killed, it expired, or it belongs to another organization.
            </p>
            {back}
          </Card.Body>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            {back}
            <span className="ml-auto flex items-center gap-2">
              {sandbox.state === 'running' && (
                <Button variant="secondary" size="sm" disabled={pause.isPending} onClick={() => pause.mutate()}>
                  <Pause className="size-4" aria-hidden="true" />
                  Pause
                </Button>
              )}
              {sandbox.state === 'paused' && (
                <Button variant="secondary" size="sm" disabled={resume.isPending} onClick={() => resume.mutate()}>
                  <Play className="size-4" aria-hidden="true" />
                  Resume
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setConfirmKill(true)}>
                <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                Kill
              </Button>
            </span>
          </div>

          {failure && (
            <p role="alert" className="text-body-sm text-destructive">
              {sandboxFailure(failure)}
            </p>
          )}

          <Card>
            <Card.Body>
              <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Fact label="State">
                  <Badge variant={STATE_VARIANTS[sandbox.state] ?? 'default'}>{sandbox.state}</Badge>
                </Fact>
                <Fact label="Image">
                  <span className="font-mono">{sandbox.image ?? '—'}</span>
                </Fact>
                <Fact label="Started">
                  <span className="tabular-nums">{formatDate(sandbox.created_at, 'datetime')}</span>
                </Fact>
                <Fact label="Running for">
                  <span className="tabular-nums">{runningFor(sandbox.created_at, now)}</span>
                </Fact>
                <Fact label="Expires in">
                  <span className="tabular-nums">{expiresIn(sandbox.expires_at, now)}</span>
                </Fact>
                <Fact label="Outbound network">{outboundNetwork(sandbox.network)}</Fact>
                <Fact label="Metadata">
                  <span className="font-mono">{metadataPairs(sandbox.metadata).join(' ') || '—'}</span>
                </Fact>
              </dl>
            </Card.Body>
          </Card>

          <Tabs value={tab} onValueChange={setTab}>
            <Tabs.List>
              <Tabs.Trigger value="network">Network</Tabs.Trigger>
              <Tabs.Trigger value="logs">Logs</Tabs.Trigger>
              <Tabs.Trigger value="monitoring">Monitoring</Tabs.Trigger>
              <Tabs.Trigger value="terminal">Terminal</Tabs.Trigger>
              <Tabs.Trigger value="files">Filesystem</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="network">
              <NetworkTab sandbox={sandbox} />
            </Tabs.Content>
            <Tabs.Content value="logs">
              <LogsTab id={id} active={tab === 'logs'} />
            </Tabs.Content>
            <Tabs.Content value="monitoring">
              <MonitoringTab id={id} active={tab === 'monitoring'} />
            </Tabs.Content>
            <Tabs.Content value="terminal">
              <TerminalTab id={id} active={tab === 'terminal'} running={sandbox.state === 'running'} />
            </Tabs.Content>
            <Tabs.Content value="files">
              <FilesTab id={id} active={tab === 'files'} />
            </Tabs.Content>
          </Tabs>
        </div>
      )}

      <ConfirmDialog
        open={confirmKill}
        onOpenChange={setConfirmKill}
        title={`Kill ${id}?`}
        description="Its processes stop and its files are deleted. This cannot be undone."
        confirmLabel="Kill sandbox"
        cancelLabel="Cancel"
        intent="destructive"
        loading={kill.isPending}
        onConfirm={() => {
          kill.mutate(id, {
            onSuccess: () => navigate('/sandboxes'),
            onSettled: () => setConfirmKill(false),
          });
        }}
      />
    </PageShell>
  );
}
