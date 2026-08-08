import { useEffect, useMemo, useRef, useState } from 'react';
import { useConexaoDoProjeto } from '@/hooks/projects/use-project-connection';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Github, Link2, Loader2, Unlink2 } from 'lucide-react';
import { Badge, Button, Card, Checkbox, Input, Label, PageShell } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { useSetPageTitle } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { engineFetch } from '@/lib/http/api';
import { derivarConexaoEfetiva, derivarEstado } from '@/hooks/projects/connect-fsm';
import type { ConnectState } from '@/hooks/projects/connect-fsm';
import type {
  InstallationRepositoriesResponse,
  InstallationRepository,
  ProjectConnection,
} from '@/lib/api/types';

/**
 * ProjectConnectPage — Plan J-09 T1.2 + T3.1.
 *
 * Finite-state machine for the install + connect workflow:
 *
 *   idle              — Not connected; no GitHub App installation yet.
 *                       Render "Install GitHub App" button.
 *   installing        — User clicked install; tab opened to GitHub.
 *                       Poll GET /connect every 2s up to 5min waiting
 *                       for installation_id to appear. Tab visibility
 *                       triggers an instant (debounced) refetch.
 *   has_installation  — installation_id known; show the repo form
 *                       (slug input today, T2.2 will swap in the picker).
 *   connected         — Repository is linked; show details + disconnect.
 *   error             — Polling timed out OR connect call failed.
 *
 * Once the dashboard issues POST /connect with a valid {repo, installation_id,
 * branch, auto_deploy} payload the backend persists the installation via
 * engine.LinkRepository -- no extra call needed from the dashboard.
 */
const POLL_TIMEOUT_MS = 5 * 60 * 1_000; // 5 min cap (EC-3 cancel guard)
/**
 * A mensagem do prazo esgotado.
 *
 * Ela vai para `installError` e não para um sinalizador próprio, e isso é o que
 * faz o polling parar: `installError` é entrada da FSM, então preenchê-lo tira
 * o estado de `installing`, e `refetchInterval` devolve `false` na sequência.
 *
 * Um sinalizador separado teria virado laço: o efeito do prazo o zeraria ao sair
 * de `installing`, a mensagem sumiria, a FSM voltaria a `installing`, e o prazo
 * recomeçaria. Uma peça de estado a menos, e ela já é reiniciada no lugar certo
 * — `handleInstallClick`, que sempre limpou o `installError`.
 */
const MENSAGEM_PRAZO_DO_INSTALL =
  "We didn't see the GitHub install complete. Try again from the install button.";
const VISIBILITY_DEBOUNCE_MS = 500;

export function ProjectConnectPage() {
  useRequireAuth();
  const { name = '' } = useParams<{ name: string }>();
  useSetPageTitle(`${name} · Connect`);

  const [searchParams] = useSearchParams();
  const isAccessUpdated = searchParams.get('updated') === '1';
  // Plan J-09 T1.1 callback redirects here as
  //   /projects/:name/connect?installed=1&installation_id=<id>
  // (or ?updated=1 when setup_action=update). The backend GET /connect
  // reads from project_repositories which is empty until POST /connect
  // runs, so without merging the query param into our state the FSM
  // would stay at idle ("Install GitHub App" forever). Parse it once
  // per mount.
  const installedQueryID = (() => {
    const raw = searchParams.get('installation_id');
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  })();

  const [busy, setBusy] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  // T2.2 — repo picker state. repos === null while fetching, [] after a
  // successful response with no accessible repos. Picker also tracks the
  // selected repo's full_name and a client-side filter string.
  const [repos, setRepos] = useState<InstallationRepository[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [repoFilter, setRepoFilter] = useState('');

  const lastVisibilityFetchRef = useRef(0);


  const conexao = useConexaoDoProjeto(name, {
    busy,
    repoUrl,
    connectError,
    installError,
    installedQueryID,
  });
  const conn = conexao.data ?? null;
  const loading = conexao.isLoading;

  // Effective conn: merge ?installation_id=<id> query param into the
  // backend response so the FSM transitions to has_installation right
  // after the callback redirect, without waiting for project_repositories
  // to be populated (which only happens after POST /connect). Backend
  // installation_id always wins if present (post-Connect persistence).
  const effectiveConn = useMemo(
    () => derivarConexaoEfetiva(conn, installedQueryID),
    [conn, installedQueryID],
  );

  // FSM derivation. Single useState would have desync hazards across
  // refetches; deriving from `effectiveConn` keeps the FSM as a function
  // of state.
  const state: ConnectState = useMemo(
    () => derivarEstado(effectiveConn, { busy, repoUrl, connectError, installError }),
    [effectiveConn, busy, repoUrl, connectError, installError],
  );


  /**
   * O PRAZO do polling — e só ele. O polling em si é `refetchInterval`.
   *
   * A separação é o ponto: antes um único `setInterval` fazia as duas coisas, e
   * o teto de 5 min era checado DENTRO do tique. Isso amarrava a precisão do
   * prazo ao período do tique e escondia a regra no meio do laço de busca.
   *
   * Agora o `setTimeout` cuida do prazo (que é o trabalho dele) e a mensagem de
   * erro é DERIVADA do sinalizador, em vez de escrita por efeito colateral de
   * dentro do tique.
   */
  useEffect(() => {
    if (state !== 'installing') return;
    const id = window.setTimeout(
      () => setInstallError(MENSAGEM_PRAZO_DO_INSTALL),
      POLL_TIMEOUT_MS,
    );
    return () => window.clearTimeout(id);
  }, [state]);

  // Visibility-change refetch: when user comes back from the GitHub
  // install tab the dashboard should pick up installation_id without
  // waiting for the next polling tick. Debounced at 500ms (EC-3) so
  // rapid alt-tab does not amplify request volume.
  useEffect(() => {
    if (state !== 'installing') return;
    const handler = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastVisibilityFetchRef.current < VISIBILITY_DEBOUNCE_MS) return;
      lastVisibilityFetchRef.current = now;
      void conexao.refetch();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [state]);

  // EC-14: ?updated=1 triggers a one-shot refetch + a banner. We never
  // remove the param from the URL — operators may want to bookmark the
  // updated-access landing page during incident triage.
  useEffect(() => {
    if (!isAccessUpdated) return;
    void conexao.refetch();
  }, [isAccessUpdated]);

  // T2.2 — fetch repos when we transition into has_installation. We do
  // NOT re-fetch on every render; the dependency on installation_id
  // ensures the call fires exactly once per installation_id value.
  const installationID = effectiveConn?.installation_id;
  useEffect(() => {
    if (!installationID || effectiveConn?.connected) return;
    let cancelled = false;
    setReposError(null);
    setRepos(null);
    void engineFetch<InstallationRepositoriesResponse>(
      `/api/v1/integrations/github/installations/${installationID}/repositories`,
    )
      .then((data) => {
        if (cancelled) return;
        setRepos(data?.repositories ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setReposError(
          "We couldn't load your repositories. Try again in a moment.",
        );
        setRepos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [installationID, effectiveConn?.connected]);

  const handleInstallClick = () => {
    setInstallError(null);
    const returnTo = encodeURIComponent(
      `/projects/${encodeURIComponent(name)}/connect`,
    );
    const installUrl = `/v1/integrations/github/install?return_to=${returnTo}`;
    // We pass `noopener,noreferrer` for security, but per spec window.open
    // returns `null` for ANY noopener call -- not just popup-blocker
    // refusals. So we cannot use the return value to distinguish "blocked"
    // from "opened with noopener". Trust the browser; if the user has a
    // popup blocker we just leave them on the dashboard waiting for
    // installation_id (the polling FSM still triggers).
    window.open(installUrl, '_blank', 'noopener,noreferrer');
    setBusy(true);
    // Trigger an immediate poll so state flips to 'installing' even
    // before the 2s interval fires.
    void conexao.refetch();
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setDisconnectError(null);
    try {
      await engineFetch(
        `/api/v1/projects/${encodeURIComponent(name)}/connect`,
        { method: 'DELETE' },
      );
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
    if (!effectiveConn?.installation_id) {
      setConnectError(
        'Install the GitHub App first to authorize this repository.',
      );
      return;
    }
    // Picker-first (T2.2): selectedRepo is the canonical source of the
    // owner/name slug. The legacy text input is preserved as a fallback
    // only when the picker did not deliver any repos (operator can still
    // type a slug while debugging).
    let repoSlug = selectedRepo.trim();
    if (!repoSlug) {
      const slugMatch = repoUrl
        .trim()
        .match(/^(?:https?:\/\/github\.com\/)?([^/\s]+\/[^/\s]+)$/);
      if (!slugMatch) {
        setConnectError('Pick a repository or enter owner/name.');
        return;
      }
      repoSlug = slugMatch[1].replace(/\.git$/, '');
    }
    setBusy(true);
    try {
      const res = await engineFetch<ProjectConnection>(
        `/api/v1/projects/${encodeURIComponent(name)}/connect`,
        {
          method: 'POST',
          body: JSON.stringify({
            repo: repoSlug,
            installation_id: effectiveConn.installation_id,
            branch,
            auto_deploy: autoDeploy,
          }),
        },
      );
      if (res === null) {
        setConnectError(
          "Couldn't connect repository. Try again in a moment.",
        );
        return;
      }
      await conexao.refetch();
      setRepoUrl('');
      setSelectedRepo('');
      setRepoFilter('');
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

  if (loading) {
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

      {isAccessUpdated && state !== 'connected' && (
        <Alert
          intent="info"
          className="mb-4"
          description="Repository access updated. Pick a repository to refresh the connection."
        />
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
                    explicit "Deploy branch (Theo)" label so the user
                    distinguishes this from GitHub's default_branch. */}
                <dt className="text-label uppercase text-muted-foreground">
                  Deploy branch (Theo)
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
      ) : !effectiveConn?.installation_id ? (
        <Card>
          <Card.Header>
            <Card.Title className="inline-flex items-center gap-2">
              <Github className="size-5" aria-hidden="true" />
              Install the Theo GitHub App
            </Card.Title>
            <Card.Description>
              Theo deploys from your GitHub repositories. Install the app on
              your org or account first, then come back here to pick a repo.
            </Card.Description>
          </Card.Header>
          <Card.Body className="space-y-4">
            <Button
              type="button"
              onClick={handleInstallClick}
              disabled={busy}
              className="inline-flex items-center gap-2"
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              <Github className="size-4" aria-hidden="true" />
              Install GitHub App
            </Button>
            {installError && (
              <Alert intent="destructive" description={installError} />
            )}
            {state === 'installing' && !installError && (
              <p className="text-body-sm text-muted-foreground">
                Waiting for the GitHub install to complete. Keep this tab open.
              </p>
            )}
          </Card.Body>
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
              {/* T4.5 of plan 2026-06-11-code-review-remediation v1.2 + ADR D6:
                  4-state repo picker extracted to <RepoPickerBlock /> below
                  the page export. Closes the project-connect.tsx
                  god-component finding by collapsing the inline 80-line
                  4-branch tree into a single component call. */}
              {repos !== null || effectiveConn?.installation_id ? (
                <RepoPickerBlock
                  repos={repos}
                  reposError={reposError}
                  installationId={effectiveConn?.installation_id}
                  selectedRepo={selectedRepo}
                  setSelectedRepo={setSelectedRepo}
                  repoFilter={repoFilter}
                  setRepoFilter={setRepoFilter}
                  onPickBranch={setBranch}
                />
              ) : (
                // Debug fallback — picker fetch never fired (no installation_id
                // somehow): show the legacy slug input.
                <div>
                  <Label htmlFor="repo-url">Repository</Label>
                  <Input
                    id="repo-url"
                    type="text"
                    placeholder="owner/repo or https://github.com/owner/repo"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    required
                  />
                </div>
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

              <Button type="submit" disabled={busy || (repos !== null && repos.length === 0)}>
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
          The Theo GitHub App is installed but has no access to any repositories yet.
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
        {reposError && (
          <p className="text-label text-destructive">{reposError}</p>
        )}
      </div>
    );
  }
  // Caller guards against this path (repos===null && !installationId), so
  // returning null here is a defensive fallback.
  return null;
}
