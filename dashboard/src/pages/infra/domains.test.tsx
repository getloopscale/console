import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({
    active: true,
    identity: { id: 'test', traits: { email: 'u@x.com' } },
  }),
}));

// B-017 — este mock era do HOOK (`useEngineApi`), ou seja, testava implementacao.
// Quando a lista migrou de ['engine', path] para a hierarquia queryKeys.domains
// — para que as mutations passassem a alcanca-la — o mock parou de alimentar a
// pagina e tres testes caíram, sem que nenhum COMPORTAMENTO tivesse mudado.
// Agora o mock e da FRONTEIRA (engineFetch): a pagina exerce o caminho de dados
// real, incluindo a query key, e o teste sobrevive ao proximo refactor interno.
const mockEngineFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({
  engineFetch: (...args: unknown[]) => mockEngineFetch(...args),
  cloudFetch: (...args: unknown[]) => mockEngineFetch(...args),
}));

const mockUseEngineApi = vi.fn();
vi.mock('@/hooks/use-api', () => ({
  useEngineApi: () => mockUseEngineApi(),
  useCloudApi: () => mockUseEngineApi(),
}));

import { Routes, Route } from 'react-router-dom';
import { DomainsPage } from './domains';

/** The page lives under a project: it reads the project from its route. */
function renderPage(path = '/projects/web/domains') {
  return render(
    <Routes>
      <Route path="/projects/:name/domains" element={<DomainsPage />} />
    </Routes>,
    { initialEntries: [path] },
  );
}

/** Alimenta o caminho de dados real da pagina (useQuery -> engineFetch). */
function seedDomains(payload: unknown) {
  mockEngineFetch.mockResolvedValue(payload);
  // Alguns filhos ainda leem via useEngineApi (ex.: selects do sheet).
  mockUseEngineApi.mockReturnValue({ data: payload, loading: false, error: false, isSuccess: true });
}

describe('DomainsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_domains_renders_list_with_status', async () => {
    seedDomains({
        domains: [
          {
            id: 'd1',
            domain: 'app.example.com',
            project: 'web',
            app: 'frontend',
            environment: 'prod',
            status: 'active',
            cname_target: 'loopscale.app',
            created_at: '2026-05-20',
            tls: { status: 'issued' },
          },
        ],
        total: 1,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('app.example.com')).toBeInTheDocument());
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('test_domains_add_domain_opens_form', async () => {
    seedDomains({ domains: [], total: 0 });
    renderPage();
    // With no domain yet the page shows its empty state, and the button still opens the form (#581).
    const add = await screen.findByRole('button', { name: /add domain/i });
    await waitFor(() => expect(screen.getByText('No custom domains yet')).toBeInTheDocument());
    fireEvent.click(add);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('test_domains_dns_record_copy_button_works', async () => {
    // Post 2026-05-26 migration (sponsor directive "all tables like /environments"):
    // DataTable expandable → Table primitive with always-visible DNS records as a
    // colSpan row directly below each pending_verification row. No click needed —
    // the information is actionable so it stays visible. CopyButton instances
    // (Brief #3 primitive) for CNAME + TXT values.
    seedDomains({
        domains: [
          {
            id: 'd1',
            domain: 'pending.example.com',
            project: 'web',
            app: 'frontend',
            environment: 'prod',
            status: 'pending_verification',
            cname_target: 'loopscale.app',
            verification: { txt_name: '_loopscale.pending', txt_value: 'verify=abc123' },
            created_at: '2026-05-23',
          },
        ],
        total: 1,
    });
    renderPage();
    // DNS records visible immediately (no expand click)
    await waitFor(() => expect(screen.getByText('CNAME')).toBeInTheDocument());
    expect(screen.getByText('TXT')).toBeInTheDocument();
    const copyButtons = screen.getAllByRole('button', { name: /copy/i });
    expect(copyButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('test_domains_verification_state_displays_correctly', async () => {
    // Post Brief #5: Verify button lives in DataTable rowActions column.
    seedDomains({
        domains: [
          {
            id: 'd1',
            domain: 'pending.example.com',
            project: 'web',
            app: 'frontend',
            environment: 'prod',
            status: 'pending_verification',
            cname_target: 'loopscale.app',
            verification: { txt_name: '_loopscale.pending', txt_value: 'verify=abc' },
            created_at: '2026-05-23',
          },
        ],
        total: 1,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Pending DNS')).toBeInTheDocument());
    // DataTable rowActions cell renders Verify button when status = pending_verification
    expect(screen.getByRole('button', { name: /^verify$/i })).toBeInTheDocument();
  });

  const row = (domain: string, project: string) => ({
    id: domain,
    domain,
    project,
    app: 'frontend',
    environment: 'production',
    status: 'active',
    cname_target: 'loopscale.app',
    created_at: '2026-05-20',
  });

  it('asks the API for the domains of the project in the route', async () => {
    seedDomains({ domains: [row('app.example.com', 'web')], total: 1 });
    renderPage('/projects/web/domains');

    await screen.findByText('app.example.com');
    const paths = mockEngineFetch.mock.calls.map((c) => String(c[0]));
    expect(paths.filter((p) => p.startsWith('/api/v1/domains?'))).toEqual([
      expect.stringContaining('project=web'),
    ]);
  });

  // The filter is the server's. This guards the screen against an answer that ignores it.
  it('lists only the domains of its project', async () => {
    seedDomains({
      domains: [row('app.example.com', 'web'), row('other.example.org', 'billing')],
      total: 2,
    });
    renderPage('/projects/web/domains');

    await screen.findByText('app.example.com');
    expect(screen.getAllByText(/\.example\.(com|org)$/).map((e) => e.textContent)).toEqual([
      'app.example.com',
    ]);
  });

  it('is titled Domains, with the project in the tab title', async () => {
    seedDomains({ domains: [], total: 0 });
    renderPage('/projects/web/domains');

    expect(await screen.findByRole('heading', { name: 'Domains' })).toBeInTheDocument();
    expect(document.title).toContain('web · Domains');
  });

  it('says the domain is removed from this project', async () => {
    seedDomains({ domains: [row('app.example.com', 'web')], total: 1 });
    renderPage('/projects/web/domains');

    fireEvent.click(await screen.findByRole('button', { name: /remove|delete/i }));
    expect(await screen.findByText(/removes the domain from this project/i)).toBeInTheDocument();
  });

  it('opens the add form for its project when asked by ?action=add', async () => {
    seedDomains({ domains: [], total: 0 });
    renderPage('/projects/web/domains?action=add');

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getAllByRole('combobox').map((c) => c.id)).toEqual(['add-domain-app', 'add-domain-env']);
  });
});
