import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({
    active: true,
    identity: { id: 'test', traits: { email: 'u@x.com' } },
  }),
}));

const mockUseEngineApi = vi.fn();
vi.mock('@/hooks/use-api', () => ({
  useEngineApi: () => mockUseEngineApi(),
  useCloudApi: () => mockUseEngineApi(),
}));

import { EnvironmentsPage } from './environments';

describe('EnvironmentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * TODA montagem passa pela ROTA REAL. Montar `<EnvironmentsPage />` solto deixava
   * `projectName` vazio, e com isso o filtro por projeto aceitava entradas SEM projeto —
   * um estado que a rota `/projects/:name/environments` não consegue produzir, porque o
   * React Router não casa `:name` vazio. Cinco testes deste arquivo provavam esse estado
   * inexistente e passavam; foi o que manteve o balde `__legacy__` vivo em revisão após o
   * M20 tê-lo tornado inalcançável (issue #377).
   */
  function renderAt(path: string) {
    return render(
      <Routes>
        <Route path="/projects/:name/environments" element={<EnvironmentsPage />} />
      </Routes>,
      { initialEntries: [path] },
    );
  }


  it('test_environments_renders_table_with_headers', () => {
    mockUseEngineApi.mockReturnValue({
      data: {
        environments: [
          { project: 'web', name: 'prod', status: 'live', projects: 3, protected: true },
        ],
      },
      loading: false,
      error: false,
    });
    renderAt('/projects/web/environments');
    // J-10 v1.1 + M2 v1.2 surface: Name, Health, Status, Protected (no
    // Domain column — that was removed before J-10 v1.1 shipped).
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Health')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getAllByText('Protected').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('prod')).toBeInTheDocument();
  });

  it('test_environments_status_dot_reflects_state', () => {
    mockUseEngineApi.mockReturnValue({
      data: {
        environments: [
          { project: 'web', name: 'prod', status: 'live', projects: 1, protected: false },
          { project: 'web', name: 'staging', status: 'failed', projects: 0, protected: false },
        ],
      },
      loading: false,
      error: false,
    });
    renderAt('/projects/web/environments');
    // T-D.2 (P-4): StatusDot label title-cased via statusLabel helper.
    // 'live' → 'Live', 'failed' → 'Failed'.
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  // T-D.2 EC-9: multi-word snake_case status title-cased
  it('test_environments_status_label_title_cases_multi_word', () => {
    mockUseEngineApi.mockReturnValue({
      data: {
        environments: [
          { project: 'web', name: 'pr-1247', status: 'pending_verification', projects: 1, protected: false },
        ],
      },
      loading: false,
      error: false,
    });
    renderAt('/projects/web/environments');
    // EC-9: 'pending_verification' should render as 'Pending Verification',
    // NOT 'Pending_verification' (broken cap-only-first behavior).
    expect(screen.getByText('Pending Verification')).toBeInTheDocument();
  });

  // J-10 v1.1 surface: protected envs render Lock + "Protected" label
  // (the v1.0 Domain column was removed). This replaces the legacy
  // test_environments_timestamp_relative_format placeholder.
  it('test_environments_protected_env_renders_lock_indicator', () => {
    mockUseEngineApi.mockReturnValue({
      data: {
        environments: [
          { project: 'web', name: 'prod', status: 'live', projects: 5, protected: true },
        ],
      },
      loading: false,
      error: false,
    });
    renderAt('/projects/web/environments');
    // "Protected" appears as table header AND as cell indicator.
    expect(screen.getAllByText('Protected').length).toBeGreaterThanOrEqual(2);
  });

  // Replaces the v1.0 copy-button test. Delete button is hidden for
  // protected envs (J-10 source line 263-275); unprotected envs render
  // it with aria-label `Delete <name>`.
  it('test_environments_unprotected_env_renders_delete_button', () => {
    mockUseEngineApi.mockReturnValue({
      data: {
        environments: [
          { project: 'web', name: 'staging', status: 'live', projects: 1, protected: false },
        ],
      },
      loading: false,
      error: false,
    });
    renderAt('/projects/web/environments');
    expect(screen.getByLabelText('Delete staging')).toBeInTheDocument();
  });

  // ===========================================================================
  // M20 — environments are project-scoped (route /projects/:name/environments).
  // The project is the ROUTE param, not a guess. The page shows only THIS
  // project's environments.
  // ===========================================================================

  it('test_M20_scopes_to_the_route_project_only', () => {
    mockUseEngineApi.mockReturnValue({
      data: {
        environments: [
          { name: 'staging', status: 'active', project: 'web', protected: false },
          { name: 'production', status: 'active', project: 'web', protected: true },
          { name: 'qa', status: 'active', project: 'api', protected: false }, // other project
        ],
      },
      loading: false,
      error: false,
    });
    renderAt('/projects/web/environments');
    // web's envs are shown…
    expect(screen.getByText('staging')).toBeInTheDocument();
    expect(screen.getByText('production')).toBeInTheDocument();
    // …and another project's env is NOT (no cross-project mixing).
    expect(screen.queryByText('qa')).not.toBeInTheDocument();
  });

  /**
   * Trava a remoção do legado (issue #377). É um teste de CARACTERIZAÇÃO, não um RED: a
   * garantia já valia antes da remoção, porque montado pela rota o filtro por projeto já
   * descartava entradas sem projeto. Ele existe para que ninguém reintroduza o balde — e
   * porque a única razão de o código morto ter sobrevivido a revisões foi não haver teste
   * que afirmasse a ausência dele.
   */
  it('test_ambiente_sem_projeto_nao_renderiza_e_nao_ha_grupo_legado', () => {
    mockUseEngineApi.mockReturnValue({
      data: {
        environments: [
          { name: 'production', status: 'active', project: 'web', protected: true },
          // Entrada no formato anterior ao M20: sem projeto. Não pertence a projeto algum,
          // logo não pertence a esta tela, que é escopada por projeto.
          { name: 'orfa', status: 'active', protected: false },
        ],
      },
      loading: false,
      error: false,
    });
    renderAt('/projects/web/environments');

    expect(screen.getByText('production')).toBeInTheDocument();
    expect(screen.queryByText('orfa')).not.toBeInTheDocument();
    // E nenhum vestígio do balde: nem o cabeçalho de grupo, nem o rótulo que ele mostrava.
    expect(screen.queryByTestId('env-group-header-legacy')).not.toBeInTheDocument();
    expect(screen.queryByText(/no project/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\(legacy\)/i)).not.toBeInTheDocument();
  });

  it('test_M20_uses_route_project_not_a_guess', () => {
    // The page must scope by the ROUTE param (api), never a guessed first
    // project or the old 'teste' fixture.
    mockUseEngineApi.mockReturnValue({
      data: {
        environments: [
          { name: 'production', status: 'active', project: 'web', protected: true },
          { name: 'preview', status: 'active', project: 'api', protected: false },
        ],
      },
      loading: false,
      error: false,
    });
    renderAt('/projects/api/environments');
    expect(screen.getByText('preview')).toBeInTheDocument();
    expect(screen.queryByText('production')).not.toBeInTheDocument();
    expect(screen.getByText(/environments for api/i)).toBeInTheDocument();
  });
});
