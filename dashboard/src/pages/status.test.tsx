// M21 T2.3 — the /status detail page the footer indicator opens.
//
// The invariant under test is the one the milestone exists for: a service that is
// NOT ok shows no version at all. That is enforced by the type (ADR D3) — these
// tests prove the rendering honors it, and that an unknown state degrades the row
// instead of blanking the page (ADR D11).
//
// Data arrives through `vi.mock('@/lib/api')`, the repo's pattern for page tests
// (precedent: `src/pages/memory/graph.test.tsx:20-23`). A global `fetch` stub cannot
// be used here: `cloudFetch` calls `ensureToken()` first (`src/lib/api.ts:184-188`),
// which in a test has no token, exchanges one against the SAME stub and then
// short-circuits to `redirectToLogin` — every data test would see `null`.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
  engineFetch: (...args: unknown[]) => mockCloudFetch(...args),
}));

import { StatusPage } from './status';

const at = '2026-07-28T10:00:00Z';

function stubVersions(report: unknown) {
  mockCloudFetch.mockResolvedValue(report);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StatusPage', () => {
  it('renders the version for a service in ok state', async () => {
    stubVersions({
      collected_at: at,
      services: [{ name: 'theo-rag', state: 'ok', checked_at: at, version: '0.35.0' }],
    });

    render(<StatusPage />);

    const row = await screen.findByTestId('service-row-theo-rag');
    expect(row).toHaveTextContent(/0\.35\.0/);
    expect(row).toHaveTextContent(/ok/i);
  });

  it('renders unreachable without any version text', async () => {
    stubVersions({
      collected_at: at,
      services: [
        { name: 'theo-rag', state: 'ok', checked_at: at, version: '0.35.0' },
        { name: 'theo-lens', state: 'unreachable', checked_at: at, reason: 'connection refused' },
      ],
    });

    render(<StatusPage />);

    const lensRow = await screen.findByTestId('service-row-theo-lens');
    expect(lensRow).toHaveTextContent(/unreachable/i);
    expect(lensRow).toHaveTextContent(/connection refused/i);
    expect(lensRow).not.toHaveTextContent(/0\.35\.0/);
    expect(lensRow).not.toHaveTextContent(/\bv\d+\.\d+\.\d+/);
  });

  it('renders timeout without any version text', async () => {
    stubVersions({
      collected_at: at,
      services: [
        { name: 'theo-rag', state: 'ok', checked_at: at, version: '0.35.0' },
        { name: 'theo-lens', state: 'timeout', checked_at: at, reason: 'deadline exceeded' },
      ],
    });

    render(<StatusPage />);

    const lensRow = await screen.findByTestId('service-row-theo-lens');
    expect(lensRow).toHaveTextContent(/timeout/i);
    expect(lensRow).not.toHaveTextContent(/\bv\d+\.\d+\.\d+/);
  });

  it('renders not_deployed as a known-absent service, not as an error', async () => {
    stubVersions({
      collected_at: at,
      services: [{ name: 'theo-storage', state: 'not_deployed', checked_at: at }],
    });

    render(<StatusPage />);

    const row = await screen.findByTestId('service-row-theo-storage');
    expect(row).toHaveTextContent(/not configured/i);
    expect(row).not.toHaveTextContent(/unreachable|error|failed/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the collection time separately from built_at', async () => {
    stubVersions({
      collected_at: at,
      services: [{ name: 'theo-rag', state: 'ok', checked_at: at, version: '0.35.0', built_at: '2026-07-01T00:00:00Z' }],
    });

    render(<StatusPage />);

    expect(await screen.findByTestId('collected-at')).toBeInTheDocument();
    const row = screen.getByTestId('service-row-theo-rag');
    expect(row).toHaveTextContent(/2026-07-01/); // built_at
    expect(screen.getByTestId('collected-at')).toHaveTextContent(/2026-07-28/); // collection — distinct
  });

  it('surfaces an alert when the aggregate cannot be read', async () => {
    mockCloudFetch.mockResolvedValue(null);

    render(<StatusPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not read/i);
  });

  // Blast radius of the F-web-2 fix: the hook now opts into `throwOnError`, so in
  // production a 5xx arrives here as a REJECTION rather than as a resolved null.
  // The page must keep telling the same truth on the path it did not use to take.
  it('surfaces the same alert when the query rejects instead of resolving null', async () => {
    mockCloudFetch.mockRejectedValue(new Error('network request failed'));

    render(<StatusPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not read/i);
  });

  it('says no services are configured instead of showing an empty page', async () => {
    stubVersions({ collected_at: at, services: [] });

    render(<StatusPage />);

    expect(await screen.findByText(/no services configured/i)).toBeInTheDocument();
  });

  // D11 / EC-5 — the payload comes from the wire, not the compiler. Throwing in the
  // default branch would blank the whole page and take the healthy services with it.
  it('renders an unknown state verbatim instead of blanking the page', async () => {
    stubVersions({
      collected_at: at,
      services: [
        { name: 'theo-rag', state: 'ok', checked_at: at, version: '0.35.0' },
        { name: 'theo-lens', state: 'quarantined', checked_at: at },
      ],
    });

    render(<StatusPage />);

    // the healthy service stays visible — this is what the blank screen destroyed
    expect(await screen.findByTestId('service-row-theo-rag')).toHaveTextContent(/0\.35\.0/);
    const alien = screen.getByTestId('service-row-theo-lens');
    expect(alien).toHaveTextContent(/quarantined/i);
    expect(alien).not.toHaveTextContent(/0\.35\.0/);
  });

  it('renders a malformed timestamp verbatim instead of crashing the page', async () => {
    stubVersions({
      collected_at: 'not-a-date',
      services: [{ name: 'theo-rag', state: 'ok', checked_at: at, version: '0.35.0' }],
    });

    render(<StatusPage />);

    expect(await screen.findByTestId('collected-at')).toHaveTextContent(/not-a-date/);
    expect(screen.getByTestId('service-row-theo-rag')).toHaveTextContent(/0\.35\.0/);
  });
});

// The route lives in the production tree, so it is asserted against the production
// file. `<App />` declares its own BrowserRouter and cannot be mounted inside the
// test MemoryRouter (precedent + rationale: `src/app.test.tsx:61-65`), and a mirrored
// route table would only prove the mirror. Reading app.tsx proves the real registration.
describe('the /status route', () => {
  it('is registered in the production route tree, before the catch-all', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/app.tsx'), 'utf8');

    const routeIdx = app.indexOf('path="/status"');
    expect(routeIdx, '/status is not registered in app.tsx — the footer link would land on not-found').toBeGreaterThan(-1);
    expect(app.slice(routeIdx, routeIdx + 200)).toMatch(/StatusPage/);

    const catchAllIdx = app.lastIndexOf('path="*"');
    expect(routeIdx).toBeLessThan(catchAllIdx);
  });
});

describe('layout em colunas', () => {
  it('apresenta os serviços como TABELA, com cabeçalho de coluna', async () => {
    // A lista de linhas flex empilhava nome, estado, versão e build num fluxo só:
    // com quatro serviços o olho não alinha nada verticalmente, e um leitor de
    // tela não tem como dizer QUAL coluna está lendo.
    //
    // `<table>` com `<th scope="col">` é o elemento nativo para dado tabular
    // (rung 3 da escada) — resolve a leitura visual E a acessibilidade sem
    // nenhuma dependência nova.
    stubVersions({
      collected_at: '2026-07-28T10:00:00Z',
      services: [
        { name: 'theo-rag', state: 'ok', version: '0.35.0', built_at: '2026-07-28T09:00:00Z' },
        { name: 'theo-storage', state: 'not_deployed' },
      ],
    });
    render(<StatusPage />);

    const table = await screen.findByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Service', 'State', 'Version', 'Built']);
  });

  it('cada serviço é uma linha, e a versão fica na coluna de versão', async () => {
    stubVersions({
      collected_at: '2026-07-28T10:00:00Z',
      services: [{ name: 'theo-rag', state: 'ok', version: '0.35.0', built_at: null }],
    });
    render(<StatusPage />);

    const row = await screen.findByTestId('service-row-theo-rag');
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent?.trim());
    expect(cells[0]).toBe('theo-rag');
    expect(cells[2]).toContain('0.35.0');
  });

  it('serviço sem versão deixa a célula VAZIA, não escreve "undefined"', async () => {
    // O invariante do D3 na camada visual: `not_deployed` não tem `version` no
    // tipo, então a célula não pode inventar texto. Vazio é a leitura honesta.
    stubVersions({
      collected_at: '2026-07-28T10:00:00Z',
      services: [{ name: 'theo-storage', state: 'not_deployed' }],
    });
    render(<StatusPage />);

    const row = await screen.findByTestId('service-row-theo-storage');
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent?.trim());
    expect(cells[2]).toBe('');
    expect(cells[3]).toBe('');
    expect(row.textContent).not.toMatch(/undefined|null|NaN/);
  });
});

// M22 T6.2 — the gateway now appears on the panel it serves.
//
// The page holds no hardcoded roster (it maps `data.services`), so the fifth row is a data change.
// What is NOT free is the aggregate sentence and the git_sha boundary — both are asserted here.
describe('M22 — theo-cloud on its own panel', () => {
  it('renders the gateway row alongside the data-plane services', async () => {
    stubVersions({
      collected_at: at,
      services: [
        { name: 'theo-cloud', state: 'ok', checked_at: at, version: '0.71.0', built_at: at },
        { name: 'theo-memory', state: 'ok', checked_at: at, version: '1.2.3' },
        { name: 'theo-rag', state: 'unreachable', checked_at: at, reason: 'connection_refused' },
      ],
    });

    render(<StatusPage />);

    const row = await screen.findByRole('row', { name: /theo-cloud/ });
    expect(within(row).getByText('0.71.0')).toBeInTheDocument();
  });

  // ROADMAP M21: git_sha is infrastructure data and must not reach the dashboard — even though it
  // IS part of the /v1/version wire contract the gateway now serves. The two surfaces are
  // deliberately different: the endpoint serves operators and the reconciler, the panel serves users.
  it('never surfaces a commit sha in the panel', async () => {
    stubVersions({
      collected_at: at,
      services: [
        {
          name: 'theo-cloud',
          state: 'ok',
          checked_at: at,
          version: '0.71.0',
          built_at: at,
          git_sha: '3c4aaf97a9bd0bfdec19ef3bc7dc64d87d8b665d',
        },
      ],
    });

    const { container } = render(<StatusPage />);
    await screen.findByRole('row', { name: /theo-cloud/ });

    expect(container.textContent ?? '').not.toMatch(/[0-9a-f]{40}/);
  });
});
