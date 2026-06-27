import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ProjectGuard } from './project-guard';

// Mock the useProjects hook — drives the guard's project-existence check.
const useProjectsMock = vi.fn();
vi.mock('@/hooks/use-projects', () => ({
  useProjects: () => useProjectsMock(),
}));

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/projects/:name/secrets"
            element={
              <ProjectGuard>
                <div data-testid="child-content">SUB-VIEW</div>
              </ProjectGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectGuard (#93 regression-protector)', () => {
  it('test_renders_loading_spinner_while_projects_loading', () => {
    useProjectsMock.mockReturnValue({ projects: [], loading: true });
    renderAt('/projects/my-api/secrets');
    expect(screen.getByLabelText('Loading project')).toBeInTheDocument();
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
  });

  it('test_renders_not_found_when_project_missing_from_list (#93)', () => {
    // Red Team #93: sub-view MUST NOT render its functional UI when the
    // parent project does not exist for this tenant. The Overview already
    // does this check; this regression-protector locks the SAME behavior
    // for every sub-route wrapped in ProjectGuard.
    useProjectsMock.mockReturnValue({
      projects: [{ name: 'other-project' }],
      loading: false,
    });
    renderAt('/projects/nonexistent-zzz/secrets');
    expect(screen.getByText(/Project not found/i)).toBeInTheDocument();
    expect(screen.getByText(/No project named "nonexistent-zzz"/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to projects/i })).toHaveAttribute(
      'href',
      '/projects',
    );
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
  });

  it('test_renders_children_when_project_exists', () => {
    useProjectsMock.mockReturnValue({
      projects: [{ name: 'my-api' }, { name: 'other-project' }],
      loading: false,
    });
    renderAt('/projects/my-api/secrets');
    expect(screen.getByTestId('child-content')).toHaveTextContent('SUB-VIEW');
    expect(screen.queryByText(/Project not found/i)).not.toBeInTheDocument();
  });

  it('test_url_encoded_project_name_round_trips_correctly', () => {
    // Defense vs SSRF-shaped URL: special characters in the URL slug must
    // be url-decoded before the lookup. The list has `my-api`; the URL
    // /projects/my%2Dapi (URL-encoded hyphen) must resolve to the same row.
    useProjectsMock.mockReturnValue({
      projects: [{ name: 'my-api' }],
      loading: false,
    });
    renderAt('/projects/my%2Dapi/secrets');
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });
});
