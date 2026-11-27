import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AddDomainSheet } from './add-domain-sheet';

const mutateAsync = vi.fn();
const buildApps = vi.hoisted(() => ({ current: [] as Array<{ name: string; type?: string }> }));

vi.mock('@/hooks/mutations/use-domains', () => ({
  useAddDomain: () => ({ mutateAsync }),
}));
// The list of projects carries a count of apps and no names, as the API answers today.
vi.mock('@/hooks/projects/use-projects', () => ({
  useProjects: () => ({ projects: [{ name: 'hello', apps_count: 1 }] }),
}));
vi.mock('@/hooks/use-environments', () => ({
  useEnvironments: () => ({ envs: ['production'] }),
}));
vi.mock('@/hooks/use-project-status', () => ({
  useProjectStatus: (name: string | undefined) => ({
    status: name ? { active_release: { build_id: 'build-1' } } : null,
    loading: false,
    error: false,
  }),
}));
vi.mock('@/hooks/deploy/use-deployment', () => ({
  useDeployment: (id: string | undefined) => ({
    build: id ? { id, apps: buildApps.current } : null,
    loading: false,
    error: false,
  }),
}));

function open() {
  render(<AddDomainSheet open onOpenChange={() => {}} defaultProject="hello" />);
  fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'app.example.com' } });
}

describe('AddDomainSheet', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue({ domain: 'app.example.com' });
  });

  // The dialog read the names from the list of projects, which has none, so it always
  // posted an empty app and the API answered 400 (getloopscale/loop-console#633).
  it('sends the app of the active build', async () => {
    buildApps.current = [{ name: 'web', type: 'server' }];
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Add domain' }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        domain: 'app.example.com',
        project: 'hello',
        app: 'web',
        environment: 'production',
      }),
    );
  });

  // On the Domains page of a project the project is the one of the route: nothing to pick.
  it('adds to the project it is given, without asking which project', async () => {
    buildApps.current = [{ name: 'web', type: 'server' }];
    render(<AddDomainSheet open onOpenChange={() => {}} project="hello" />);
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'app.example.com' } });

    expect(screen.getAllByRole('combobox').map((c) => c.id)).toEqual(['add-domain-app', 'add-domain-env']);
    fireEvent.click(screen.getByRole('button', { name: 'Add domain' }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        domain: 'app.example.com',
        project: 'hello',
        app: 'web',
        environment: 'production',
      }),
    );
  });

  it('says the project has no app and sends nothing', async () => {
    buildApps.current = [];
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Add domain' }));

    expect(await screen.findByText(/has no deployed app in production/)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
