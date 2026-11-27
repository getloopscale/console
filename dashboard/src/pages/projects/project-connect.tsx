import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Github, Link2, Loader2, Unlink2 } from 'lucide-react';
import { Badge, Button, Card, Checkbox, Input, Label } from '@getloopscale/ui';
import { PageShell } from '@/components/ui/page-shell';
import { Alert } from '@/components/ui/alert-guard';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { useSetPageTitle } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { useProjectConnected } from '@/hooks/projects/use-project-connection';
import { useGitHubInstallations } from '@/hooks/projects/use-github-installations';
import {
  fetchInstallationRepositories,
  connectProjectRepository,
  disconnectProjectRepository,
} from '@/hooks/projects/github-connect';
import { deriveConnectStep } from '@/hooks/projects/connect-fsm';
import { githubErrorMessage, INSTALLATION_NEEDS_AUTHORIZATION } from '@/hooks/projects/github-connect-errors';
import { ApiError, refusalReason } from '@/lib/http/api';
import { safeNavigator } from '@/lib/navigation';
import type { InstallationRepository } from '@/lib/api/types';

/**
 * ProjectConnectPage: link a project to a GitHub repository.
 *
 * The page reads two things from the engine: the project's connection and the GitHub App
 * installations GitHub confirmed for the team. From those it shows one of four steps (see
 * `deriveConnectStep`): the linked repository, the button that starts the GitHub authorization,
 * the account picker, or the repository picker.
 *
 * The authorization runs in this tab. The button goes to `/v1/integrations/github/install`, GitHub
 * asks the user to authorize (and to install the App when it is missing), and the control plane
 * sends the browser back here. That return is a fresh page load, so there is nothing to poll.
 *
 * The page URL can carry `github_error=<code>` (shown as a sentence) and `updated=1` (a banner).
 * It never supplies an installation id.
 */
export function ProjectConnectPage() {
  useRequireAuth();
  const { name = '' } = useParams<{ name: string }>();
  useSetPageTitle(`${name} · Connect`);

  const [searchParams] = useSearchParams();
  const isAccessUpdated = searchParams.get('updated') === '1';
  const githubError = githubErrorMessage(searchParams.get('github_error'));

  const [busy, setBusy] = useState(false);
  const [branch, setBranch] = useState('main');
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [selectedInstallationId, setSelectedInstallationId] = useState<number | undefined>();
  // True once the engine answered 403 for the installation in use: GitHub has not confirmed it
  // for this team, and only a new authorization changes that.
  const [needsAuthorization, setNeedsAuthorization] = useState(false);

  // repos === null while fetching, [] after a successful response with no accessible repos.
  const [repos, setRepos] = useState<InstallationRepository[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [repoFilter, setRepoFilter] = useState('');

  const conexao = useProjectConnected(name);
  const conn = conexao.data ?? null;
  const installationsQuery = useGitHubInstallations({
    enabled: conexao.isSuccess && !conn?.connected,
  });
  const installations = installationsQuery.data ?? [];

  const step = deriveConnectStep(conn, installations, selectedInstallationId);
  const installationID = step.step === 'pick_repository' ? step.installationId : undefined;

  // Fetch the repositories of the installation in use, once per installation.
  useEffect(() => {
    if (!installationID) return;
    let cancelled = false;
    setReposError(null);
    setRepos(null);
    setSelectedRepo('');
    setNeedsAuthorization(false);
    void fetchInstallationRepositories(installationID)
      .then((data) => {
        if (cancelled) return;
        setRepos(data?.repositories ?? []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 403) {
          setNeedsAuthorization(true);
        } else {
          setReposError("We couldn't load your repositories. Try again in a moment.");
        }
        setRepos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [installationID]);

  const handleAuthorize = () => {
    const returnTo = encodeURIComponent(`/projects/${encodeURIComponent(name)}/connect`);
    safeNavigator.goTo(`/v1/integrations/github/install?return_to=${returnTo}`);
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setDisconnectError(null);
    try {
      await disconnectProjectRepository(name);
      await conexao.refetch();
      setDisconnectOpen(false);
    } catch (e) {
      // M18: a failed disconnect must NOT no-op silently (the repo stays
      // connected + auto-deploying). Surface the error so the user retries.
      setDisconnectError(
        e instanceof Error
          ? `Disconnect failed: ${e.message}. The repository is still connected — retry, or contact support if it persists.`
          : 'Disconnect failed. The repository is still connected — retry, or contact support if it persists.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnectError(null);
    if (!installationID) {
      setConnectError('Pick a GitHub account first.');
      return;
    }
    const repoSlug = selectedRepo.trim();
    if (!repoSlug) {
      setConnectError('Pick a repository to connect.');
      return;
    }
    setBusy(true);
    try {
      await connectProjectRepository(name, {
        repo: repoSlug,
        installation_id: installationID,
        branch,
        auto_deploy: autoDeploy,
      });
      await conexao.refetch();
      setSelectedRepo('');
      setRepoFilter('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setNeedsAuthorization(true);
      } else {
        setConnectError(refusalReason(err) ?? "Couldn't connect repository. Try again in a moment.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (conexao.isError) {
    return (
      <PageShell title="Connect">
        <Alert
          intent="destructive"
          title="Could not load the connection state"
          description="The request to the engine failed. Reload the page to try again."
        />
      </PageShell>
    );
  }

  if (conexao.isLoading || (!conn?.connected && installationsQuery.isLoading)) {
    return (
      <PageShell title="Connect">
        <div className="flex items-center justify-center py-12">
          <Loader2
            className="size-6 animate-spin text-muted-foreground"
            aria-label="Loading connection state"
          />
        </div>
      </PageShell>
    );
  }

  const authorizeButton = (label: string) => (
    <Button type="button" onClick={handleAuthorize} className="inline-flex items-center gap-2">
      <Github className="size-4" aria-hidden="true" />
      {label}
    </Button>
  );

  return (
    <PageShell title="Repository connection" description={`GitHub link for ${name}.`}>
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link
            to={`/projects/${encodeURIComponent(name)}`}
            className="inline-flex items-center gap-1"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span>Back to project</span>
          </Link>
        </Button>
      </div>

      {isAccessUpdated && step.step !== 'connected' && (
        <Alert
          intent="info"
          className="mb-4"
          description="Repository access updated. Pick a repository to refresh the connection."
        />
      )}

      {githubError && step.step !== 'connected' && (
        <Alert intent="destructive" className="mb-4" description={githubError} />
      )}

      {conn?.connected ? (
        <Card>
          <Card.Header>
            <div className="flex items-center justify-between gap-4">
              <Card.Title className="inline-flex items-center gap-2">
                <Github className="size-5" aria-hidden="true" />
                Connected
              </Card.Title>
              <Badge variant="success" className="text-label uppercase">
                Active
              </Badge>
            </div>
          </Card.Header>
          <Card.Body className="space-y-4">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-body-sm">
              <div>
                <dt className="text-label uppercase text-muted-foreground">
                  Repository
                </dt>
                <dd className="mt-1 font-mono text-foreground break-all">
                  {(() => {
                    // `repo` é o slug `owner/name`; a URL se deriva dele. O ramo por
                    // `repo_url` saiu com o campo legado (#377).
                    const slug = conn.repo ?? '—';
                    const href = conn.repo ? `https://github.com/${conn.repo}` : undefined;
                    return href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-primary"
                      >
                        {slug}
                      </a>
                    ) : (
                      <span>{slug}</span>
                    );
                  })()}
                </dd>
              </div>
              <div>
                {/* #120 (qa-dogfood-cleanup-2026-06-21 T4.1 / ADR-Q3):
                    explicit "Deploy branch (LoopScale)" label so the user
                    distinguishes this from GitHub's default_branch. */}
                <dt className="text-label uppercase text-muted-foreground">
                  Deploy branch (LoopScale)
                </dt>
                <dd className="mt-1 font-mono text-foreground">{conn.branch ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-label uppercase text-muted-foreground">
                  Auto deploy
                </dt>
                <dd className="mt-1 text-foreground">
                  {conn.auto_deploy ? 'Enabled — deploy on push to branch' : 'Disabled'}
                </dd>
              </div>
              {conn.installation_id && (
                <div>
                  <dt className="text-label uppercase text-muted-foreground">
                    Installation
                  </dt>
                  <dd className="mt-1 font-mono text-foreground">
                    {conn.installation_id}
                  </dd>
                </div>
              )}
            </dl>

            {disconnectError && (
              <Alert intent="destructive" description={disconnectError} className="mb-3" />
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDisconnectOpen(true)}
              disabled={busy}
              className="inline-flex items-center gap-2"
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              <Unlink2 className="size-4" aria-hidden="true" />
              Disconnect repository
            </Button>
            <ConfirmDialog
              open={disconnectOpen}
              onOpenChange={setDisconnectOpen}
              title="Disconnect repository?"
              description="Auto-deploy on push will stop. Existing deployments stay live; you can reconnect later."
              intent="destructive"
              confirmLabel="Disconnect"
              onConfirm={handleDisconnect}
              loading={busy}
            />
          </Card.Body>
        </Card>
      ) : installationsQuery.isError ? (
        <Alert
          intent="destructive"
          title="Could not load your GitHub installations"
          description="The request to the engine failed. Reload the page to try again."
        />
      ) : step.step === 'authorize' ? (
        <Card>
          <Card.Header>
            <Card.Title className="inline-flex items-center gap-2">
              <Github className="size-5" aria-hidden="true" />
              Connect LoopScale to GitHub
            </Card.Title>
            <Card.Description>
              LoopScale deploys from your GitHub repositories. GitHub asks you to authorize
              LoopScale and, if the LoopScale App is not installed yet, to install it on your
              account or organization. You come back here to pick a repository.
            </Card.Description>
          </Card.Header>
          <Card.Body>{authorizeButton('Continue to GitHub')}</Card.Body>
        </Card>
      ) : (
        <Card>
          <Card.Header>
            <Card.Title className="inline-flex items-center gap-2">
              <Github className="size-5" aria-hidden="true" />
              Connect a GitHub repository
            </Card.Title>
            <Card.Description>
              Auto-deploy on push to your branch. Every deploy ships a signed, verifiable image.
            </Card.Description>
          </Card.Header>
          <Card.Body>
            <form onSubmit={handleConnect} className="space-y-4">
              {installations.length > 1 && (
                <div className="space-y-2">
                  <Label htmlFor="github-account">GitHub account</Label>
                  <select
                    id="github-account"
                    className="w-full rounded-md border bg-background px-3 py-2 text-body-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={installationID ?? ''}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      setSelectedInstallationId(Number.isFinite(id) && id > 0 ? id : undefined);
                    }}
                  >
                    <option value="">Pick an account…</option>
                    {installations.map((i) => (
                      <option key={i.id} value={i.id}>
                        {`${i.account_login} (${i.account_type})`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {needsAuthorization ? (
                <div className="space-y-3">
                  <Alert intent="warning" description={INSTALLATION_NEEDS_AUTHORIZATION} />
                  {authorizeButton('Authorize on GitHub')}
                </div>
              ) : (
                installationID !== undefined && (
                  <RepoPickerBlock
                    repos={repos}
                    reposError={reposError}
                    installationId={installationID}
                    selectedRepo={selectedRepo}
                    setSelectedRepo={setSelectedRepo}
                    repoFilter={repoFilter}
                    setRepoFilter={setRepoFilter}
                    onPickBranch={setBranch}
                  />
                )
              )}

              <div>
                <Label htmlFor="branch">Branch</Label>
                <Input
                  id="branch"
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  required
                />
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="auto-deploy"
                  checked={autoDeploy}
                  onCheckedChange={(c) => setAutoDeploy(c === true)}
                />
                <div>
                  <Label htmlFor="auto-deploy">Auto-deploy on push</Label>
                  <p className="text-label text-muted-foreground">
                    Triggers a build whenever a commit lands on the selected branch.
                  </p>
                </div>
              </div>

              {connectError && (
                <Alert intent="destructive" description={connectError} />
              )}

              <Button
                type="submit"
                disabled={
                  busy || needsAuthorization || installationID === undefined || repos === null || repos.length === 0
                }
              >
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                <Link2 className="size-4" aria-hidden="true" />
                {busy ? 'Connecting…' : 'Connect repository'}
              </Button>
            </form>
          </Card.Body>
        </Card>
      )}
    </PageShell>
  );
}

// RepoPickerBlock — T4.5 of plan 2026-06-11-code-review-remediation v1.2
// + ADR D6. Extracted from ProjectConnectPage to collapse the 4-branch
// 80-line repo-picker inline tree into a focused subcomponent. Closes
// the project-connect.tsx god-component finding (file size + parent
// CC remain bounded so future repo-picker UX changes touch a single
// component, not the page's render tree).
//
// 4 states:
//   1. repos === null && installationId  → loading placeholder
//   2. repos !== null && repos.length===0 → empty-state with App config link
//   3. repos !== null && repos.length > 0 → picker (filter + select)
//   4. (caller decides) — no installation → debug-only slug input lives in
//      the page parent (not here; that path is an operator escape hatch).
function RepoPickerBlock({
  repos,
  reposError,
  installationId,
  selectedRepo,
  setSelectedRepo,
  repoFilter,
  setRepoFilter,
  onPickBranch,
}: {
  repos: InstallationRepository[] | null;
  reposError: string | null;
  installationId: number | undefined;
  selectedRepo: string;
  setSelectedRepo: (v: string) => void;
  repoFilter: string;
  setRepoFilter: (v: string) => void;
  onPickBranch: (branch: string) => void;
}) {
  // The list could not be loaded: say so, and do not claim the App has no repositories.
  if (reposError) {
    return <Alert intent="destructive" description={reposError} />;
  }
  // State 1: loading (App installed, fetch in flight)
  if (repos === null && installationId) {
    return (
      <div className="flex items-center gap-2 text-body-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading your repositories…
      </div>
    );
  }
  // State 2: empty (App installed but no repo access yet)
  if (repos !== null && repos.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-body-sm">
        <p className="font-medium">No repositories available</p>
        <p className="text-muted-foreground">
          The LoopScale GitHub App is installed but has no access to any repositories yet.
        </p>
        <a
          className="mt-2 inline-block underline hover:text-primary"
          href={`https://github.com/settings/installations/${installationId ?? ''}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Configure App access on GitHub
        </a>
      </div>
    );
  }
  // State 3: picker (the canonical happy path)
  if (repos !== null) {
    return (
      <div className="space-y-2">
        <Label htmlFor="repo-filter">Filter</Label>
        <Input
          id="repo-filter"
          type="text"
          placeholder="Filter by name…"
          value={repoFilter}
          onChange={(e) => setRepoFilter(e.target.value)}
          autoFocus
        />
        <Label htmlFor="repo-select">Repository</Label>
        <select
          id="repo-select"
          className="w-full rounded-md border bg-background px-3 py-2 text-body-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={selectedRepo}
          onChange={(e) => {
            const v = e.target.value;
            setSelectedRepo(v);
            const match = repos.find((r) => r.full_name === v);
            if (match) onPickBranch(match.default_branch);
          }}
        >
          <option value="">Pick a repository…</option>
          {repos
            .filter((r) =>
              repoFilter
                ? r.full_name.toLowerCase().includes(repoFilter.toLowerCase())
                : true,
            )
            .map((r) => (
              <option key={r.full_name} value={r.full_name}>
                {r.full_name}
                {r.private ? ' (private)' : ''}
              </option>
            ))}
        </select>
      </div>
    );
  }
  // Caller guards against this path (repos===null && !installationId), so
  // returning null here is a defensive fallback.
  return null;
}
