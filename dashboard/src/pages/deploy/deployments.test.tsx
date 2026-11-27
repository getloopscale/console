import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Build, BuildListResponse } from '@/lib/api/types';
import { queryClient } from '@/lib/http/query-client';

vi.mock('@/lib/http/api', () => ({
  signOutIfSessionEnded: vi.fn(async () => false),
  engineFetch: vi.fn(),
  cloudFetch: vi.fn(),
}));

vi.mock('@/lib/http/config', () => ({ API_URL: '' }));

// Skip the auth gate.
vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => undefined }));

import { DeploymentsPage } from './deployments';
import { engineFetch, signOutIfSessionEnded } from '@/lib/http/api';
import { __setTransporte, __resetSharedEventSources } from '@/hooks/deploy/shared-event-source';

const mockedEngineFetch = vi.mocked(engineFetch);

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, Array<(ev: unknown) => void>> = {};
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;

  opcoes: { lastEventId?: string | null } | undefined;
  constructor(url: string, opcoes?: { lastEventId?: string | null }) {
    this.opcoes = opcoes;
    this.url = url;
    MockEventSource.instances.push(this);
    queueMicrotask(() => this.onopen?.({}));
  }
  addEventListener(type: string, l: (ev: unknown) => void) {
    (this.listeners[type] ??= []).push(l);
  }
  removeEventListener() {}
  emit(type: string, data: unknown, lastEventId = '') {
    const ev = { data: JSON.stringify(data), lastEventId };
    (this.listeners[type] ?? []).forEach((l) => l(ev));
  }
  close() {
    this.closed = true;
  }
}

function makeBuild(id: string, overrides: Partial<Build> = {}): Build {
  return {
    build_id: id,
    project_id: 'p-1',
    environment: 'production',
    status: 'succeeded',
    commit_sha: 'abc1234567890',
    created_by: 'paulo@loopscale.test',
    created_at: '2026-06-06T00:00:00Z',
    ...overrides,
  };
}

/**
 * B-197 — o adaptador de teste do `nuqs` substitui o de produção.
 *
 * `test_status_filter_chips_work` clica num chip de status, e o filtro vive na URL via `nuqs`. O
 * `MemoryRouter` era recriado a cada render, mas o `NuqsAdapter` de produção guarda o estado num
 * cache de MÓDULO — então o filtro atravessava a fronteira do teste. Em ordem fixa aquele caso
 * rodava por último e ninguém via; sob shuffle, o caso seguinte montava a página com "Succeeded"
 * já pressionado (`aria-pressed="true"` no corpo renderizado), a lista vinha filtrada, e a
 * asserção sobre o commit sha caía sem nenhuma pista de por quê.
 *
 * `NuqsTestingAdapter` mantém o estado por RENDER em vez de por módulo — é a ferramenta que a
 * própria biblioteca publica para isto, e não um contorno nosso.
 */
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/teste/deployments']}>
        <NuqsTestingAdapter hasMemory>
          <Routes>
            <Route path="/projects/:name/deployments" element={<DeploymentsPage />} />
          </Routes>
        </NuqsTestingAdapter>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // B-197 — o `queryClient` de `lib/http/query-client.ts` é um SINGLETON de módulo, então o cache
  // do TanStack Query atravessa arquivos de teste. Em ordem fixa isto nunca aparecia; sob
  // `--sequence.shuffle` esta página lia dados que outro arquivo deixou cacheados sob a mesma
  // chave, e a asserção sobre o commit sha caía. Limpar é barato e torna o caso independente.
  // B-197 — DOIS estados de módulo atravessavam arquivos de teste e faziam este bloco depender de
  // quem rodou antes:
  //
  //   1. o `queryClient` de `lib/http/query-client.ts` é singleton, então o cache do TanStack
  //      Query sobrevive entre arquivos;
  //   2. o registro do `SharedEventSource` é um `Map` de módulo — o stream desta página reusava
  //      uma conexão aberta por outro arquivo, e a página nunca recebia os eventos que este caso
  //      emite.
  //
  // Em ordem fixa nenhum dos dois aparecia. Sob `--sequence.shuffle`, os dois.
  queryClient.clear();
  __resetSharedEventSources();
  MockEventSource.instances = [];
  // B-197 — `vi.clearAllMocks()` limpa CHAMADAS e não IMPLEMENTAÇÕES. Dois casos deste arquivo
  // usam `mockImplementation`, e a implementação deles sobrevivia para quem rodasse depois: em
  // ordem fixa eles vinham por último e ninguém notava; sob shuffle, um caso que espera uma
  // resposta simples herdava a implementação condicional de outro e renderizava nada.
  //
  // `mockReset` apaga a implementação; os padrões que o arquivo assume são reinstalados logo
  // abaixo, para que cada caso comece do mesmo lugar em vez de do que o anterior deixou.
  mockedEngineFetch.mockReset();
  vi.mocked(signOutIfSessionEnded).mockReset().mockResolvedValue(false);
    // B-088 — o transporte deixou de ser o EventSource global (o JWT foi para
    // o header Authorization). O fake expoe a mesma superficie; muda so onde
    // ele e instalado.
    __setTransporte((url, opcoes) => new MockEventSource(url, opcoes) as unknown as EventSource);
  vi.clearAllMocks();
});

afterEach(() => {
    __setTransporte(null);
});

describe('DeploymentsPage', () => {
  it('test_initial_load_from_rest', async () => {
    mockedEngineFetch.mockResolvedValue({
      builds: [makeBuild('b-1', { commit_sha: '1234567890' })],
      total: 1,
    } as BuildListResponse);

    renderPage();

    await waitFor(() => expect(screen.queryByText(/no deployments/i)).not.toBeInTheDocument());
    expect(screen.getByText('1234567')).toBeInTheDocument();
  });

  // B-242 — the anchor for the absence assertion above. No case in this file ever showed the
  // empty state, so `queryByText(/no deployments/i)` was satisfied by a list that rendered AND by
  // a `semDeploysAinda` whose title had been reworded — the second one silently. This case renders
  // it, so the wording is now under test on both sides.
  it('a project with zero builds shows the empty state the case above denies', async () => {
    mockedEngineFetch.mockResolvedValue({ builds: [], total: 0 } as BuildListResponse);

    renderPage();

    expect(await screen.findByText(/no deployments yet/i)).toBeInTheDocument();
  });

  it('test_new_build_appends_in_realtime', async () => {
    let callCount = 0;
    mockedEngineFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          builds: [makeBuild('b-1', { commit_sha: 'aaaaaaa' })],
          total: 1,
        } as BuildListResponse;
      }
      return {
        builds: [
          makeBuild('b-1', { commit_sha: 'aaaaaaa' }),
          makeBuild('b-2', {
            commit_sha: 'bbbbbbb',
            status: 'running',
            created_at: '2026-06-06T01:00:00Z',
          }),
        ],
        total: 2,
      } as BuildListResponse;
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('aaaaaaa')).toBeInTheDocument());

    // Emit SSE event for unknown build_id → triggers refetch.
    const es = MockEventSource.instances[0];
    expect(es).toBeDefined();
    await act(async () => {
      es.emit('build.started', { build_id: 'b-2', status: 'running' });
    });

    await waitFor(() => expect(screen.getByText('bbbbbbb')).toBeInTheDocument());
  });

  it('test_existing_build_updates_status_in_place', async () => {
    mockedEngineFetch.mockResolvedValue({
      builds: [makeBuild('b-1', { commit_sha: 'aaaaaaa', status: 'running' })],
      total: 1,
    } as BuildListResponse);

    renderPage();

    // Multiple "Running" matches exist (filter button + StatusDot). We
    // target the row by its commit SHA cell, then look inside for the
    // status label that lives there.
    await waitFor(() => expect(screen.getByText('aaaaaaa')).toBeInTheDocument());
    const row = screen.getByText('aaaaaaa').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText(/running/i)).toBeInTheDocument();

    const es = MockEventSource.instances[0];
    await act(async () => {
      es.emit('build.succeeded', { build_id: 'b-1', status: 'succeeded' });
    });

    await waitFor(() => {
      const newRow = screen.getByText('aaaaaaa').closest('tr');
      expect(within(newRow as HTMLElement).getByText(/succeeded/i)).toBeInTheDocument();
    });
    // SSE patches in place, no refetch of the BUILDS LIST. (useProjectStatus
    // refetches its own /status endpoint on a separate interval; we only
    // assert the builds list query was hit once.)
    const buildsCalls = mockedEngineFetch.mock.calls.filter(([p]) =>
      typeof p === 'string' && p.includes('/builds'),
    );
    expect(buildsCalls.length).toBe(1);
  });

  // Red Team loop-console#121 (P0 eixo 2 — UI honesty): when production's
  // active release was promoted FROM a preview build, the production
  // env_target.active_release.build_id IS the preview build's id (promote
  // copies the build reference, doesn't rebuild). Pre-fix `isActive`
  // compared `activeBuildId === b.build_id` GLOBALLY, so the PREVIEW row
  // (whose build_id matched) got the "● Active" badge + Live URL → production
  // — while the row labeled [PRODUCTION] (an older superseded build) got
  // nothing. The UI was lying about which row was serving production.
  //
  // Post-fix: ACTIVE badge is per-env — preview row gets ACTIVE only if it
  // matches preview env's active build_id; production row gets ACTIVE only
  // if it matches production env's active build_id. Live URL per row reflects
  // THAT row's env (preview → preview URL, production → production URL).
  it('test_active_badge_is_per_env_not_global_buildid_match_121', async () => {
    // Two builds, BOTH with commit 013e5ca (the canonical "promote of same
    // source code" scenario from #121 evidence):
    //   - build-bba6f3b9 origin=production (older — superseded by promote)
    //   - build-b431fb74 origin=preview (the actually-serving release in BOTH envs)
    const builds: Build[] = [
      makeBuild('build-bba6f3b997377da1', {
        environment: 'production',
        commit_sha: '013e5ca017a1f01b04fa3850f40d1f7392266674',
        created_at: '2026-06-29T15:00:00Z',
      }),
      makeBuild('build-b431fb74a6dfc7cc', {
        environment: 'preview',
        commit_sha: '013e5ca017a1f01b04fa3850f40d1f7392266674',
        created_at: '2026-06-29T14:00:00Z',
      }),
    ];
    // Both env status endpoints return active_release.build_id =
    // build-b431fb74 (production's release was promoted from preview;
    // preview's release is still the same preview build).
    mockedEngineFetch.mockImplementation(async (path: unknown) => {
      const url = String(path);
      if (url.includes('/status?env=production') || (url.includes('/status') && !url.includes('env='))) {
        return {
          active_release: {
            build_id: 'build-b431fb74a6dfc7cc',
            git_commit: '013e5ca017a1f01b04fa3850f40d1f7392266674',
            created_at: '2026-06-30T06:11:26Z',
          },
          url: 'https://example-app-production.getloopscale.app',
          last_build: { build_id: 'build-bba6f3b997377da1', environment: 'production' },
        };
      }
      if (url.includes('/status?env=preview')) {
        return {
          active_release: {
            build_id: 'build-b431fb74a6dfc7cc',
            git_commit: '013e5ca017a1f01b04fa3850f40d1f7392266674',
            created_at: '2026-06-29T14:50:00Z',
          },
          url: 'https://example-app-preview.getloopscale.app',
          last_build: { build_id: 'build-b431fb74a6dfc7cc', environment: 'preview' },
        };
      }
      if (url.includes('/builds')) {
        return { builds, total: builds.length } as BuildListResponse;
      }
      return {} as BuildListResponse;
    });

    renderPage();

    // Wait for both rows to render — the View link for each build_id
    // is the canonical row anchor (env badge text is "Production" /
    // "Preview" but both rows display the same SHA "013e5ca" so SHA-text
    // queries cannot disambiguate). The activeSha banner above the table
    // also renders "013e5ca", contributing a 3rd match.
    await waitFor(() => {
      const prodAnchor = document.querySelector(
        'a[href="/projects/teste/deployments/build-bba6f3b997377da1"]',
      );
      const previewAnchor = document.querySelector(
        'a[href="/projects/teste/deployments/build-b431fb74a6dfc7cc"]',
      );
      expect(prodAnchor).not.toBeNull();
      expect(previewAnchor).not.toBeNull();
    });

    // Find each row by its build_id-derived View link INSIDE a table row
    // (the activeSha banner ALSO links to /deployments/{activeBuildId},
    // so a naive querySelector picks the banner not the row — scope by
    // <tr> ancestry to disambiguate).
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const prodRow = rows.find((tr) =>
      tr.querySelector('a[href="/projects/teste/deployments/build-bba6f3b997377da1"]'),
    ) as HTMLElement | undefined;
    const previewRow = rows.find((tr) =>
      tr.querySelector('a[href="/projects/teste/deployments/build-b431fb74a6dfc7cc"]'),
    ) as HTMLElement | undefined;

    expect(prodRow).toBeDefined();
    expect(previewRow).toBeDefined();

    // Red Team #121 invariant — neither row should get the production
    // ACTIVE badge when its OWN env's active build_id doesn't match.
    // The preview row's build IS the preview env's active build → it
    // legitimately gets ACTIVE (for preview). The production row's build
    // is NOT the production env's active build (it was superseded) →
    // no ACTIVE badge.
    //
    // PRE-FIX assertion that would FAIL: the global isActive check
    // (activeBuildId === b.build_id) put ACTIVE on the preview row
    // matching the production endpoint's response — i.e., the PRODUCTION
    // row would NOT get ACTIVE and the PREVIEW row would get ACTIVE +
    // Live URL → production.
    //
    // POST-FIX: ACTIVE on a row means "this row's env is serving this
    // build NOW". Live URL on a row is THAT env's URL.
    const prodActive = within(prodRow!).queryByText(/●\s*Active/i);
    const previewActive = within(previewRow!).queryByText(/●\s*Active/i);

    // The production row's build is superseded → no ACTIVE here.
    expect(prodActive).toBeNull();

    // The preview row's build IS the preview env's active → ACTIVE here.
    expect(previewActive).not.toBeNull();

    // Live URL — preview row's Visit link must point to PREVIEW URL,
    // never to production URL.
    const previewVisitLink = previewRow!.querySelector('a[href*="-preview."]');
    const previewVisitLinkProd = previewRow!.querySelector('a[href*="-production."]');
    expect(previewVisitLinkProd).toBeNull();
    // Note: the Visit icon component renders a link only when isActive;
    // since previewActive is set above, the preview URL link should exist.
    expect(previewVisitLink).not.toBeNull();
  });

  // A project whose first build is still running has no release. The banner used to fall
  // back to the last build's commit and announce it as serving production.
  it('names no commit as serving production while the project has no active release', async () => {
    const builds: Build[] = [
      makeBuild('build-c84daa5191812ab9', {
        status: 'running',
        environment: 'production',
        commit_sha: '602f3c255148d392c2c3e7b22f8376513da928f4',
      }),
    ];
    mockedEngineFetch.mockImplementation(async (path: unknown) => {
      const url = String(path);
      if (url.includes('/status')) {
        return {
          active_release: null,
          url: '',
          last_build: {
            id: 'build-c84daa5191812ab9',
            status: 'RUNNING',
            commit_sha: '602f3c255148d392c2c3e7b22f8376513da928f4',
          },
        };
      }
      if (url.includes('/builds')) {
        return { builds, total: builds.length } as BuildListResponse;
      }
      return {} as BuildListResponse;
    });

    renderPage();

    await screen.findByRole('link', { name: /view/i });
    expect(screen.queryByText(/currently serving production/i)).toBeNull();
  });

  // After a rollback the serving release is an old one. Its creation time read as
  // "deployed 14 minutes ago" seconds after the rollback finished.
  it('dates the serving banner by the last deploy, not by the creation of the release', async () => {
    const builds: Build[] = [makeBuild('build-c84daa5191812ab9', { environment: 'production' })];
    mockedEngineFetch.mockImplementation(async (path: unknown) => {
      const url = String(path);
      if (url.includes('/status')) {
        return {
          active_release: {
            build_id: 'build-c84daa5191812ab9',
            git_commit: '602f3c255148d392c2c3e7b22f8376513da928f4',
            created_at: '2020-01-01T00:00:00Z',
          },
          last_deploy_at: new Date(Date.now() - 20_000).toISOString(),
          url: 'https://example-app-production.getloopscale.app',
        };
      }
      if (url.includes('/builds')) {
        return { builds, total: builds.length } as BuildListResponse;
      }
      return {} as BuildListResponse;
    });

    renderPage();

    const banner = await screen.findByLabelText(/production active commit 602f3c2/i);
    expect(within(banner).getByText(/seconds ago/i)).toBeInTheDocument();
  });

  it('counts only the rows the status filter shows in the footer', async () => {
    mockedEngineFetch.mockResolvedValue({
      builds: [
        makeBuild('b-1', { commit_sha: 'aaaaaaa', status: 'failed' }),
        makeBuild('b-2', { commit_sha: 'bbbbbbb', status: 'failed' }),
        makeBuild('b-3', { commit_sha: 'ccccccc', status: 'succeeded' }),
        makeBuild('b-4', { commit_sha: 'ddddddd', status: 'succeeded' }),
      ],
      total: 4,
    } as BuildListResponse);

    renderPage();
    await waitFor(() => expect(screen.getByText('Showing 4 of 4 deployments')).toBeInTheDocument());

    const group = screen.getByRole('group', { name: /filter by status/i });
    await userEvent.click(within(group).getByRole('button', { name: /^failed$/i }));

    await waitFor(() => expect(screen.getByText('Showing 2 of 4 deployments')).toBeInTheDocument());
  });

  it('shows a build whose deploy failed as "Deploy failed" and finds it under Failed', async () => {
    mockedEngineFetch.mockResolvedValue({
      builds: [
        makeBuild('b-1', { commit_sha: 'aaaaaaa', status: 'succeeded', deploy_status: 'failed' }),
        makeBuild('b-2', { commit_sha: 'bbbbbbb', status: 'succeeded', deploy_status: 'succeeded' }),
        makeBuild('b-3', { commit_sha: 'ccccccc', status: 'failed' }),
      ],
      total: 3,
    } as BuildListResponse);

    renderPage();
    await waitFor(() => expect(screen.getByText('Showing 3 of 3 deployments')).toBeInTheDocument());
    const row = screen.getByText('aaaaaaa').closest('tr') as HTMLElement;
    expect(within(row).getByText('Deploy failed')).toBeInTheDocument();
    expect(within(screen.getByText('bbbbbbb').closest('tr') as HTMLElement).getByText('Succeeded')).toBeInTheDocument();

    const group = screen.getByRole('group', { name: /filter by status/i });
    await userEvent.click(within(group).getByRole('button', { name: /^failed$/i }));

    await waitFor(() => expect(screen.getByText('Showing 2 of 3 deployments')).toBeInTheDocument());
    expect(screen.getByText('aaaaaaa')).toBeInTheDocument();
    expect(screen.getByText('ccccccc')).toBeInTheDocument();
  });

  it('test_status_filter_chips_work', async () => {
    mockedEngineFetch.mockResolvedValue({
      builds: [makeBuild('b-1', { commit_sha: 'aaaaaaa' })],
      total: 1,
    } as BuildListResponse);

    renderPage();
    await waitFor(() => expect(screen.getByText('aaaaaaa')).toBeInTheDocument());

    const group = screen.getByRole('group', { name: /filter by status/i });
    await userEvent.click(within(group).getByRole('button', { name: /^running$/i }));

    // Filter pushes status= into URL → triggers refetch with new queryKey.
    //
    // B-197 — a asserção olhava a ÚLTIMA chamada. Esta página tem mais de um hook fazendo request,
    // e qual deles termina por último depende do escalonamento — sob shuffle, a última era
    // `/status?env=…` de outro hook e o caso caía sem que nada estivesse errado. O que ele quer
    // provar é que o filtro CHEGA ao request, não que foi o request mais recente.
    await waitFor(() => {
      const chamadas = mockedEngineFetch.mock.calls.map((c) => String(c[0]));
      expect(chamadas.some((u) => u.includes('?status=running'))).toBe(true);
    });
  });

  // A rollback changes what production runs and builds nothing: it is listed between the
  // builds, where it happened, with who asked and how it ended.
  it('lists a rollback as a row of its own between the builds', async () => {
    mockedEngineFetch.mockImplementation(async (path: string) => {
      if (path.endsWith('/rollbacks')) {
        return {
          rollbacks: [
            {
              id: 'rb-1',
              environment: 'production',
              status: 'failed',
              failure_reason: 'sync timeout',
              from: { release_id: 'rel-new', build_id: 'b-new' },
              to: { release_id: 'rel-old', build_id: 'b-old' },
              created_by: 'paulo@loopscale.test',
              created_at: '2026-06-06T02:00:00Z',
              finished_at: '2026-06-06T02:01:10Z',
            },
          ],
        };
      }
      return {
        builds: [
          makeBuild('b-new', { commit_sha: 'bbbbbbb1111', created_at: '2026-06-06T01:00:00Z' }),
          makeBuild('b-old', { commit_sha: 'aaaaaaa0000', created_at: '2026-06-06T00:00:00Z' }),
        ],
        total: 2,
      } as BuildListResponse;
    });

    renderPage();

    const row = await screen.findByTestId('rollback-row');
    expect(within(row).getByText('Rollback failed')).toBeInTheDocument();
    expect(row).toHaveTextContent('Rollback to aaaaaaa');
    expect(row).toHaveTextContent('sync timeout');
    expect(row).toHaveTextContent('1m 10s');
    expect(within(row).getByRole('link', { name: 'View rollback to aaaaaaa' })).toHaveAttribute(
      'href',
      '/projects/teste/deployments/rollbacks/rb-1',
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toBe(row);
    expect(rows[1]).toHaveTextContent('bbbbbbb');
    expect(screen.getByText(/Showing 2 of 2 deployments and 1 rollback$/)).toBeInTheDocument();
  });
});
