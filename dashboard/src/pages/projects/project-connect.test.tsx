import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@/test/render';
import { Route, Routes } from 'react-router-dom';
import { ApiError } from '@/lib/http/api';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ id: 'test-user', email: 'test@example.com' }),
}));

const engineFetchMock = vi.fn();
vi.mock('@/lib/http/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/http/api')>('@/lib/http/api');
  return {
    ...actual,
    engineFetch: (path: string, opts?: RequestInit) => engineFetchMock(path, opts),
  };
});

const goToMock = vi.fn((_url: string) => true);
const openInNewTabMock = vi.fn((_url: string) => true);
vi.mock('@/lib/navigation', async () => {
  const actual = await vi.importActual<typeof import('@/lib/navigation')>('@/lib/navigation');
  return {
    ...actual,
    safeNavigator: {
      goTo: (url: string) => goToMock(url),
      openInNewTab: (url: string) => openInNewTabMock(url),
    },
  };
});

import { ProjectConnectPage } from './project-connect';

const INSTALLATIONS_PATH = '/api/v1/integrations/github/installations';
const INSTALL_URL = `/v1/integrations/github/install?return_to=${encodeURIComponent('/projects/demo/connect')}`;

const ACME = { id: 7, account_login: 'acme', account_type: 'Organization' };
const DEV = { id: 9, account_login: 'dev', account_type: 'User' };

function renderConnect(search = '') {
  return render(
    <Routes>
      <Route path="/projects/:name/connect" element={<ProjectConnectPage />} />
    </Routes>,
    { initialEntries: [`/projects/demo/connect${search}`] },
  );
}

function repoList() {
  return [
    { full_name: 'owner/api', default_branch: 'main', private: false, language: 'Go' },
    { full_name: 'owner/web', default_branch: 'develop', private: true, language: 'TypeScript' },
  ];
}

interface Engine {
  installations: Array<typeof ACME>;
  /** Answer for GET .../installations/{id}/repositories. */
  repositories: (installationId: number) => unknown;
  /** Answer for POST /connect. */
  connect: (body: Record<string, unknown>) => unknown;
}

/** Every request the page made, as `METHOD path`. */
let requests: string[];
let posts: Array<Record<string, unknown>>;

function mockEngine(overrides: Partial<Engine> = {}) {
  const engine: Engine = {
    installations: [],
    repositories: () => ({ repositories: repoList() }),
    connect: (body) => ({ connected: true, ...body }),
    ...overrides,
  };
  engineFetchMock.mockImplementation(async (path: string, opts?: RequestInit) => {
    const method = (opts?.method ?? 'GET').toUpperCase();
    requests.push(`${method} ${path}`);
    if (method === 'GET' && path === INSTALLATIONS_PATH) {
      return { installations: engine.installations };
    }
    const repos = path.match(/\/installations\/(\d+)\/repositories$/);
    if (method === 'GET' && repos) return engine.repositories(Number(repos[1]));
    if (method === 'GET') return { connected: false };
    if (method === 'POST') {
      const body = JSON.parse(String(opts?.body ?? '{}')) as Record<string, unknown>;
      posts.push(body);
      return engine.connect(body);
    }
    return null;
  });
}

const repositoryRequests = () => requests.filter((r) => r.endsWith('/repositories'));

beforeEach(() => {
  requests = [];
  posts = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('ProjectConnectPage with no installation confirmed for the team', () => {
  it('offers one button, which starts the GitHub authorization in this tab', async () => {
    mockEngine({ installations: [] });
    renderConnect();

    const button = await screen.findByRole('button', { name: /continue to github/i });
    expect(screen.getAllByRole('button', { name: /github/i })).toHaveLength(1);
    fireEvent.click(button);

    expect(goToMock).toHaveBeenCalledWith(INSTALL_URL);
    expect(openInNewTabMock).not.toHaveBeenCalled();
  });

  it('does not take an installation from the page URL', async () => {
    mockEngine({ installations: [] });
    renderConnect('?installed=1&installation_id=42');

    expect(await screen.findByRole('button', { name: /continue to github/i })).toBeInTheDocument();
    // No picker: the authorization button is the only control, and no repository was asked for.
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(repositoryRequests()).toEqual([]);
  });

  it('does not wait for an install by polling', async () => {
    mockEngine({ installations: [] });
    renderConnect();
    const button = await screen.findByRole('button', { name: /continue to github/i });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(button);
    const before = requests.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(requests.length).toBe(before);
  });
});

describe('ProjectConnectPage with one installation', () => {
  it('goes straight to the repository picker of that installation', async () => {
    mockEngine({ installations: [ACME] });
    renderConnect();

    await waitFor(() => expect(screen.getByLabelText(/^repository$/i)).toBeInTheDocument());
    expect(screen.getByRole('option', { name: /owner\/api/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /owner\/web \(private\)/ })).toBeInTheDocument();
    expect(repositoryRequests()).toEqual([`GET ${INSTALLATIONS_PATH}/7/repositories`]);
    // The repository select is the only one: no account picker for a single installation.
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });

  it('pre-fills the branch with the default branch of the picked repository', async () => {
    mockEngine({ installations: [ACME] });
    renderConnect();
    const select = (await screen.findByLabelText(/^repository$/i)) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'owner/web' } });
    expect((screen.getByLabelText(/^branch$/i) as HTMLInputElement).value).toBe('develop');
  });

  it('links to the App settings when the installation has no repository', async () => {
    mockEngine({ installations: [ACME], repositories: () => ({ repositories: [] }) });
    renderConnect();
    const link = await screen.findByRole('link', { name: /configure app access/i });
    expect(link.getAttribute('href')).toBe('https://github.com/settings/installations/7');
  });

  it('connects with the installation id from the list, whatever the URL says', async () => {
    mockEngine({ installations: [ACME] });
    renderConnect('?installation_id=999');
    const select = (await screen.findByLabelText(/^repository$/i)) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'owner/api' } });
    fireEvent.click(screen.getByRole('button', { name: /connect repository/i }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      repo: 'owner/api',
      installation_id: 7,
      branch: 'main',
      auto_deploy: true,
    });
  });

  it('asks for a repository before connecting', async () => {
    mockEngine({ installations: [ACME] });
    renderConnect();
    await screen.findByLabelText(/^repository$/i);
    fireEvent.click(screen.getByRole('button', { name: /connect repository/i }));
    expect(await screen.findByText(/pick a repository/i, { selector: 'p, div, span' })).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });
});

describe('ProjectConnectPage with several installations', () => {
  it('lets the user pick the account before listing repositories', async () => {
    mockEngine({ installations: [ACME, DEV] });
    renderConnect();

    const account = (await screen.findByLabelText(/github account/i)) as HTMLSelectElement;
    expect(screen.getByRole('option', { name: 'acme (Organization)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'dev (User)' })).toBeInTheDocument();
    // Only the account select so far: the repositories wait for the choice.
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(repositoryRequests()).toEqual([]);

    fireEvent.change(account, { target: { value: '9' } });

    await waitFor(() => expect(screen.getByLabelText(/^repository$/i)).toBeInTheDocument());
    expect(repositoryRequests()).toEqual([`GET ${INSTALLATIONS_PATH}/9/repositories`]);
  });

  it('connects with the chosen account', async () => {
    mockEngine({ installations: [ACME, DEV] });
    renderConnect();
    fireEvent.change(await screen.findByLabelText(/github account/i), { target: { value: '9' } });
    fireEvent.change(await screen.findByLabelText(/^repository$/i), { target: { value: 'owner/api' } });
    fireEvent.click(screen.getByRole('button', { name: /connect repository/i }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ repo: 'owner/api', installation_id: 9 });
  });
});

describe('ProjectConnectPage errors', () => {
  it.each([
    ['GITHUB_CODE_REJECTED', /authorization expired/i],
    ['INSUFFICIENT_ROLE', /admin or the owner/i],
    ['NO_INSTALLATION', /no installation of the loopscale app/i],
    ['GITHUB_UNAVAILABLE', /github could not be reached/i],
    ['SOMETHING_NEW', /something went wrong while connecting github/i],
  ])('shows a sentence for github_error=%s and keeps the button', async (code, message) => {
    mockEngine({ installations: [] });
    renderConnect(`?github_error=${code}`);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue to github/i })).toBeInTheDocument();
  });

  it('says the installation needs authorization when the repository list answers 403', async () => {
    mockEngine({
      installations: [ACME],
      repositories: () => {
        throw new ApiError(403, { code: 'FORBIDDEN' });
      },
    });
    renderConnect();

    expect(await screen.findByText(/installation needs authorization/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /authorize on github/i }));
    expect(goToMock).toHaveBeenCalledWith(INSTALL_URL);
  });

  it('says the installation needs authorization when connect answers 403', async () => {
    mockEngine({
      installations: [ACME],
      connect: () => {
        throw new ApiError(403, { code: 'FORBIDDEN' });
      },
    });
    renderConnect();
    fireEvent.change(await screen.findByLabelText(/^repository$/i), { target: { value: 'owner/api' } });
    fireEvent.click(screen.getByRole('button', { name: /connect repository/i }));

    expect(await screen.findByText(/installation needs authorization/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /authorize on github/i })).toBeInTheDocument();
  });

  it('keeps the retry message for a repository list that fails for another reason', async () => {
    mockEngine({
      installations: [ACME],
      repositories: () => {
        throw new ApiError(502);
      },
    });
    renderConnect();
    expect(await screen.findByText(/couldn.t load your repositories/i)).toBeInTheDocument();
  });

  it('keeps the retry message for a connect that fails for another reason', async () => {
    mockEngine({
      installations: [ACME],
      connect: () => {
        throw new ApiError(500);
      },
    });
    renderConnect();
    fireEvent.change(await screen.findByLabelText(/^repository$/i), { target: { value: 'owner/api' } });
    fireEvent.click(screen.getByRole('button', { name: /connect repository/i }));
    expect(await screen.findByText(/couldn.t connect repository/i)).toBeInTheDocument();
  });

  it('shows the reason the API gives when it refuses the connect', async () => {
    const reason =
      'loopscale.yaml not found on branch "main". Add it at the repository root, declaring the apps to deploy under `apps:`, and commit it.';
    mockEngine({
      installations: [ACME],
      connect: () => {
        throw new ApiError(400, { code: 'MISSING_DEPLOY_DESCRIPTOR', message: reason });
      },
    });
    renderConnect();
    fireEvent.change(await screen.findByLabelText(/^repository$/i), { target: { value: 'owner/api' } });
    fireEvent.click(screen.getByRole('button', { name: /connect repository/i }));

    // The whole alert is the API's sentence, with no retry advice next to it.
    expect((await screen.findByText(reason)).textContent).toBe(reason);
  });

  it('keeps the retry message when a server error carries a message', async () => {
    mockEngine({
      installations: [ACME],
      connect: () => {
        throw new ApiError(503, { message: 'upstream connect error' });
      },
    });
    renderConnect();
    fireEvent.change(await screen.findByLabelText(/^repository$/i), { target: { value: 'owner/api' } });
    fireEvent.click(screen.getByRole('button', { name: /connect repository/i }));

    expect((await screen.findByText(/couldn.t connect repository/i)).textContent).toBe(
      "Couldn't connect repository. Try again in a moment.",
    );
  });

  it('says so when the installations cannot be loaded', async () => {
    engineFetchMock.mockImplementation(async (path: string) => {
      if (path === INSTALLATIONS_PATH) throw new ApiError(500);
      return { connected: false };
    });
    renderConnect();
    expect(await screen.findByText(/could not load your github installations/i)).toBeInTheDocument();
  });
});

describe('ProjectConnectPage after an access update', () => {
  it('shows the updated banner', async () => {
    mockEngine({ installations: [ACME] });
    renderConnect('?updated=1');
    expect(await screen.findByText(/repository access updated/i)).toBeInTheDocument();
  });
});
