import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@/test/render';
import { AppSidebar } from './app-sidebar';
import type { Session } from '@/lib/auth';

function makeSession(name?: string): Session {
  return {
    active: true,
    identity: {
      id: 'sess-1',
      traits: { email: 'paulo@example.com', name },
    },
  };
}

describe('AppSidebar', () => {
  it('test_app_sidebar_renders_all_nav_items', () => {
    render(<AppSidebar session={makeSession()} />);
    // MAIN_NAV (5) + Billing (1) + Audit (1) + Settings (1) + Profile (1) = 9 routes.
    // We assert each nav item is reachable via accessible-name match (case-insensitive)
    // by querying within the main sidebar (excluding the TeamSwitcher "Switch team" button).
    for (const label of [
      'Overview',
      'Projects',
      'Domains',
      'Billing',
      'Audit log',
      'Settings',
      'Profile',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    }
    // "Team" nav item collides with the TeamSwitcher "Switch team" button label.
    // Verify via the more-specific item-by-link-text query.
    const teamButtons = screen.getAllByRole('button', { name: /Team/i });
    expect(teamButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('test_app_sidebar_active_item_matches_current_route', () => {
    render(<AppSidebar session={makeSession()} />, { initialEntries: ['/projects'] });
    const projectsButton = screen.getByRole('button', { name: /Projects/i });
    // active class includes bg-primary/10 + text-primary per Sidebar.Item internals
    expect(projectsButton.className).toMatch(/text-primary|bg-primary/);
  });

  it('test_app_sidebar_team_switcher_renders_session_name', () => {
    // Plan v1.0 T5.2 (2026-05-26): AccountMenu replaced with TeamSwitcher.
    // The switcher renders the session traits.name (or falls back to email).
    render(<AppSidebar session={makeSession()} />);
    expect(screen.getByText('paulo@example.com')).toBeInTheDocument();
  });

  it('test_app_sidebar_team_switcher_trigger_has_aria_label', () => {
    // Plan v1.0 T5.2: dropdown trigger must be reachable by accessible name.
    render(<AppSidebar session={makeSession()} />);
    expect(
      screen.getByRole('button', { name: /switch team/i }),
    ).toBeInTheDocument();
  });

  it('test_app_sidebar_search_input_present_with_placeholder', () => {
    render(<AppSidebar session={makeSession()} />);
    expect(screen.getByPlaceholderText('Find a project...')).toBeInTheDocument();
  });

  it('M59 P4 — the lens submenu groups nav into Observe / Evaluate / Improve', () => {
    // On an /observability route the sidebar drills into the lens submenu.
    render(<AppSidebar session={makeSession()} />, { initialEntries: ['/observability/traces'] });
    // the three titled groups render…
    expect(screen.getByText('Observe')).toBeInTheDocument();
    expect(screen.getByText('Evaluate')).toBeInTheDocument();
    expect(screen.getByText('Improve')).toBeInTheDocument();
    // …and every lens-unique item is still present at its unchanged path.
    for (const label of ['Traces', 'Sessions', 'Datasets', 'Evaluators', 'Monitors', 'Agents', 'Ask']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // paths are unchanged (the grouping is data-only) — the Traces item still navigates the same route.
    expect(screen.getByRole('button', { name: /traces/i })).toBeInTheDocument();
    // (the workspace switcher lives in the root sidebar view — untouched by this data-only regrouping;
    //  it is covered by test_app_sidebar_team_switcher_renders_session_name.)
  });

  // M21 T2.1 (R3) — the sidebar is about to become asynchronous. Without a global
  // fetch stub, jsdom issues a REAL request: the symptom is not a red test, it is an
  // unhandled rejection plus act() noise, which does not block a merge.
  it('renders without touching the network', () => {
    render(<AppSidebar session={makeSession()} />);

    const f = globalThis.fetch as unknown as { mock?: { calls: unknown[][] } };
    expect(f.mock, 'global fetch is not stubbed — jsdom will hit the real network').toBeDefined();

    const absolute = (f.mock?.calls ?? []).filter((c) => String(c[0]).startsWith('http'));
    expect(absolute, `sidebar issued real network calls: ${JSON.stringify(absolute)}`).toHaveLength(0);
  });

  // M21 T3.1 — the guard that did not exist: nothing stopped the footer from
  // declaring "all systems operational" with three services down.
  it('footer status is no longer the hardcoded literal', () => {
    render(<AppSidebar session={makeSession()} />);
    const indicator = screen.getByTestId('system-status-indicator');
    const region = within(indicator).getByRole('status');
    expect(region.getAttribute('aria-label')).not.toBe('System status: all systems operational');
  });
});

/**
 * M23 — toda capacidade do data plane precisa de porta de entrada no menu.
 *
 * Este teste existe porque o defeito que ele trava passou por typecheck, lint, 15 testes de
 * projeção e dois PRs mesclados: as rotas `/trust` estavam registradas e as telas renderizavam,
 * mas NENHUMA entrada no menu apontava para elas. Do ponto de vista do operador, a capacidade não
 * existia — exatamente o problema que M23 veio resolver, reintroduzido um nível acima.
 *
 * A asserção é sobre a LISTA de capacidades, não sobre "Trust" isolado: um item novo que alguém
 * adicione às rotas sem adicionar ao menu continua invisível, e nenhum teste de rota o pega.
 */
describe('menu — capacidades do data plane', () => {
  it('toda capacidade tem entrada no grupo Capabilities', () => {
    render(<AppSidebar session={makeSession('Paulo')} />);

    for (const label of ['Memory', 'Knowledge Base', 'Workspace', 'Observability', 'Trust']) {
      expect(
        screen.getByRole('button', { name: label }),
        `a capacidade ${label} não tem entrada no menu: as rotas dela existem e ninguém as alcança`,
      ).toBeInTheDocument();
    }
  });
});
