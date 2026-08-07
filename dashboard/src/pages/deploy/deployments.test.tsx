import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Build, BuildListResponse } from '@/lib/api/types';

vi.mock('@/lib/http/api', () => ({
  ensureSSEToken: vi.fn(async () => 'tok'),
  clearToken: vi.fn(),
  hasValidToken: vi.fn(() => true),
  engineFetch: vi.fn(),
  cloudFetch: vi.fn(),
}));

vi.mock('@/lib/http/config', () => ({ API_URL: '' }));

// Skip the auth gate.
vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => undefined }));

import { DeploymentsPage } from './deployments';
import { engineFetch } from '@/lib/http/api';

const mockedEngineFetch = vi.mocked(engineFetch);

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, Array<(ev: unknown) => void>> = {};
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;

  constructor(url: string) {
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
    created_by: 'paulo@theo.test',
    created_at: '2026-06-06T00:00:00Z',
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/teste/deployments']}>
        <NuqsAdapter>
          <Routes>
            <Route path="/projects/:name/deployments" element={<DeploymentsPage />} />
          </Routes>
        </NuqsAdapter>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  MockEventSource.instances = [];
  // @ts-expect-error global stub
  globalThis.EventSource = MockEventSource;
  vi.clearAllMocks();
});

afterEach(() => {
  // @ts-expect-error restore
  delete globalThis.EventSource;
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

  // Red Team theo-cloud#121 (P0 eixo 2 — UI honesty): when production's
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
          url: 'https://example-app-production.prod-dev.usetheo.dev',
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
          url: 'https://example-app-preview.prod-dev.usetheo.dev',
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
    await waitFor(() => {
      const calls = mockedEngineFetch.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall?.[0]).toContain('?status=running');
    });
  });
});
