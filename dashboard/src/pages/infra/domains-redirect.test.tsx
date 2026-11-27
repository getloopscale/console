import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { Routes, Route, useLocation } from 'react-router-dom';

const mockUseProjects = vi.fn();
vi.mock('@/hooks/projects/use-projects', () => ({
  useProjects: () => mockUseProjects(),
}));

import { DomainsRedirect } from './domains-redirect';

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderAt(path: string) {
  return render(
    <Routes>
      <Route path="/domains" element={<DomainsRedirect />} />
      <Route path="*" element={<Where />} />
    </Routes>,
    { initialEntries: [path] },
  );
}

/**
 * /domains used to be the list of every domain of the organization. Domains now live inside a
 * project, and the old address sends whoever still has it to the right place.
 */
describe('DomainsRedirect', () => {
  it('goes to the domains of the only project', () => {
    mockUseProjects.mockReturnValue({ projects: [{ name: 'hello' }], loading: false, error: false });
    renderAt('/domains');
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/hello/domains');
  });

  it('keeps ?action=add on the way to the domains of the only project', () => {
    mockUseProjects.mockReturnValue({ projects: [{ name: 'my api' }], loading: false, error: false });
    renderAt('/domains?action=add');
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/my%20api/domains?action=add');
  });

  it('goes to the list of projects when there are several', () => {
    mockUseProjects.mockReturnValue({
      projects: [{ name: 'hello' }, { name: 'billing' }],
      loading: false,
      error: false,
    });
    renderAt('/domains?action=add');
    expect(screen.getByTestId('where').textContent).toBe('/projects');
  });

  it('goes to the list of projects when there is none', () => {
    mockUseProjects.mockReturnValue({ projects: [], loading: false, error: false });
    renderAt('/domains');
    expect(screen.getByTestId('where').textContent).toBe('/projects');
  });

  // An empty list while loading reads as "no project". Redirecting then would send the owner of
  // one project to the list instead of to its domains.
  it('waits for the list of projects before going anywhere', () => {
    mockUseProjects.mockReturnValue({ projects: [], loading: true, error: false });
    renderAt('/domains');
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('goes to the list of projects when the list could not be read', () => {
    mockUseProjects.mockReturnValue({ projects: [], loading: false, error: true });
    renderAt('/domains');
    expect(screen.getByTestId('where').textContent).toBe('/projects');
  });
});
