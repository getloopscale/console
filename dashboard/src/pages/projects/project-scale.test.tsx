import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/render';
import { Routes, Route } from 'react-router-dom';
import type { ProjectStatusDetail } from '@/lib/api/types';

// M15 T1: the Scale page must show the REAL current replica count from the
// project status, not the hardcoded DEFAULT_CURRENT_REPLICAS=2.

const mockUseProjectStatus = vi.fn();
vi.mock('@/hooks/use-project-status', () => ({
  useProjectStatus: () => mockUseProjectStatus(),
}));
vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => undefined }));
const mockMutateAsync = vi.fn();
vi.mock('@/hooks/projects/use-scale', () => ({
  useScale: () => ({ mutate: vi.fn(), mutateAsync: mockMutateAsync, isPending: false, error: null, data: undefined }),
}));
const mockUseDeployment = vi.fn();
vi.mock('@/hooks/deploy/use-deployment', () => ({
  useDeployment: (buildId: string | undefined) => mockUseDeployment(buildId),
}));
// The confirm dialog's type-to-confirm flow has its own tests; here it only has to call onConfirm.
const mockDialogProps = vi.fn();
vi.mock('@/pages/projects/components/scale-confirm-dialog', () => ({
  ScaleConfirmDialog: (props: { open: boolean; onConfirm: () => void }) => {
    mockDialogProps(props);
    return props.open ? <button type="button" onClick={props.onConfirm}>Confirm scale</button> : null;
  },
}));

import { ProjectScalePage } from './project-scale';

function renderAt(path: string) {
  return render(
    <Routes>
      <Route path="/projects/:name/scale" element={<ProjectScalePage />} />
    </Routes>,
    { initialEntries: [path] },
  );
}

function status(partial: Partial<ProjectStatusDetail>): ProjectStatusDetail {
  return { project: 'demo', environment: 'production', ...partial } as ProjectStatusDetail;
}

function buildWithApps(apps: Array<{ name: string; type?: string }>) {
  return { build: { build_id: 'build-1', apps }, loading: false, error: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMutateAsync.mockResolvedValue({ plan_tier: 'pro', monthly_cost_usd: 10 });
  mockUseDeployment.mockReturnValue(buildWithApps([{ name: 'web', type: 'server' }]));
});

async function applyScale() {
  fireEvent.click(screen.getByRole('button', { name: /apply scale/i }));
  fireEvent.click(screen.getByRole('button', { name: /confirm scale/i }));
  await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
}

describe('ProjectScalePage — the app it scales', () => {
  it("scales the project's only server app, read from the active release build", async () => {
    mockUseProjectStatus.mockReturnValue({
      status: status({ plan_tier: 'pro', active_release: { id: 'r1', build_id: 'build-1', status: 'ACTIVE', created_at: '' } }),
    });
    renderAt('/projects/demo/scale');
    await applyScale();
    expect(mockUseDeployment).toHaveBeenCalledWith('build-1');
    expect(mockMutateAsync.mock.calls[0][0].app).toBe('web');
  });

  it('lets the user pick when the project has several server apps', async () => {
    mockUseDeployment.mockReturnValue(
      buildWithApps([
        { name: 'web', type: 'server' },
        { name: 'api', type: 'server' },
        { name: 'jobs', type: 'worker' },
      ]),
    );
    mockUseProjectStatus.mockReturnValue({
      status: status({ plan_tier: 'pro', active_release: { id: 'r1', build_id: 'build-1', status: 'ACTIVE', created_at: '' } }),
    });
    renderAt('/projects/demo/scale');
    const picker = screen.getByLabelText(/^app$/i);
    expect(Array.from((picker as HTMLSelectElement).options).map((o) => o.value)).toEqual(['web', 'api']);
    fireEvent.change(picker, { target: { value: 'api' } });
    await applyScale();
    expect(mockMutateAsync.mock.calls[0][0].app).toBe('api');
  });

  it('does not offer to scale before a build names the apps', () => {
    mockUseDeployment.mockReturnValue({ build: null, loading: false, error: false });
    mockUseProjectStatus.mockReturnValue({ status: status({ plan_tier: 'pro' }) });
    renderAt('/projects/demo/scale');
    expect(screen.getByRole('button', { name: /apply scale/i })).toBeDisabled();
    expect(screen.getByText(/deploy the project once/i)).toBeInTheDocument();
  });
});

describe('ProjectScalePage — what runs', () => {
  it('does not report the requested count as running after a save', async () => {
    mockUseProjectStatus.mockReturnValue({
      status: status({
        plan_tier: 'pro',
        active_release: { id: 'r1', build_id: 'build-1', status: 'ACTIVE', created_at: '' },
        scaling: { replicas: 2, min: 2, max: 2, scaled_to_zero: false },
      }),
    });
    renderAt('/projects/demo/scale');
    fireEvent.change(screen.getByLabelText(/replicas:/i), { target: { value: '1' } });
    await applyScale();
    expect(mockMutateAsync.mock.calls[0][0].replicas).toBe(1);
    // The API reported no running count, so the page must not claim one.
    expect(screen.getByTestId('running-replicas')).toHaveTextContent(/not reported/i);
  });

  it('shows the running count the API reports', () => {
    mockUseProjectStatus.mockReturnValue({
      status: status({ plan_tier: 'pro', replicas_ready: 2, replicas_desired: 2 }),
    });
    renderAt('/projects/demo/scale');
    expect(screen.getByTestId('running-replicas')).toHaveTextContent('2 replicas');
    // Anchors the "never 2 replicas" denial in the M15 case below: the page can render this text.
    expect(screen.getAllByText(/2 replicas/).length).toBeGreaterThanOrEqual(1);
  });
});

describe('ProjectScalePage — real current replicas (M15 T1)', () => {

  it('seeds the current replica count from status.scaling.replicas (not a hardcoded 2)', () => {
    mockUseProjectStatus.mockReturnValue({
      status: status({ plan_tier: 'pro', scaling: { replicas: 10, min: 10, max: 10, scaled_to_zero: false } }),
    });
    renderAt('/projects/demo/scale');
    // The Cost card's "Current" row must reflect the real 10, never the fake 2.
    expect(screen.getAllByText(/10 replicas/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/2 replicas/)).not.toBeInTheDocument();
  });

  it('falls back to replicas_desired when scaling is absent', () => {
    mockUseProjectStatus.mockReturnValue({
      status: status({ plan_tier: 'pro', replicas_desired: 5 }),
    });
    renderAt('/projects/demo/scale');
    expect(screen.getAllByText(/5 replicas/).length).toBeGreaterThanOrEqual(1);
  });

  it('does not invent a configured count when the API reports none', () => {
    mockUseProjectStatus.mockReturnValue({ status: status({ plan_tier: 'starter' }) });
    renderAt('/projects/demo/scale');
    expect(screen.getByTestId('configured-replicas')).toHaveTextContent(/not reported/i);
  });

  it('gives the confirmation no current count when the API reports none', () => {
    // The slider seed is not the project's count; passing it made the dialog claim "no change".
    mockUseProjectStatus.mockReturnValue({ status: status({ plan_tier: 'starter' }) });
    renderAt('/projects/demo/scale');
    fireEvent.click(screen.getByRole('button', { name: /apply scale/i }));
    expect(mockDialogProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, current: null }),
    );
  });
});

describe('ProjectScalePage, a saved autoscaling range', () => {
  const autoscaled = () =>
    status({
      plan_tier: 'pro',
      active_release: { id: 'r1', build_id: 'build-1', status: 'ACTIVE', created_at: '' },
      scaling: { replicas: 1, min: 1, max: 3, scaled_to_zero: false },
    });

  it('opens in Auto mode with the saved bounds', () => {
    // Staging: after saving 1 to 3 and reloading, the page said "Manual", 1 replica (#567).
    mockUseProjectStatus.mockReturnValue({ status: autoscaled() });
    renderAt('/projects/demo/scale');
    expect(screen.getByRole('radio', { name: /auto/i })).toBeChecked();
    expect((screen.getByLabelText(/minimum replicas/i) as HTMLInputElement).value).toBe('1');
    expect((screen.getByLabelText(/maximum replicas/i) as HTMLInputElement).value).toBe('3');
    expect(screen.getByTestId('configured-replicas')).toHaveTextContent('autoscaling, 1 to 3 replicas');
  });

  it('opens with the saved CPU and memory targets', () => {
    mockUseProjectStatus.mockReturnValue({
      status: status({
        plan_tier: 'pro',
        scaling: { replicas: 1, min: 1, max: 3, scaled_to_zero: false, target_cpu: 65, target_memory: 55 },
      }),
    });
    renderAt('/projects/demo/scale');
    expect((screen.getByLabelText(/cpu target/i) as HTMLInputElement).value).toBe('65');
    expect((screen.getByLabelText(/memory target/i) as HTMLInputElement).value).toBe('55');
  });

  it('tells the confirmation both sides of a change of mode', () => {
    mockUseProjectStatus.mockReturnValue({
      status: status({ plan_tier: 'pro', scaling: { replicas: 3, min: 3, max: 3, scaled_to_zero: false } }),
    });
    renderAt('/projects/demo/scale');
    fireEvent.click(screen.getByRole('radio', { name: /auto/i }));
    fireEvent.click(screen.getByRole('button', { name: /apply scale/i }));
    expect(mockDialogProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        current: { kind: 'fixed', replicas: 3 },
        proposed: { kind: 'auto', min: 1, max: 3 },
      }),
    );
  });

  it('keeps the minimum at or below the maximum', () => {
    mockUseProjectStatus.mockReturnValue({ status: autoscaled() });
    renderAt('/projects/demo/scale');
    fireEvent.change(screen.getByLabelText(/minimum replicas/i), { target: { value: '5' } });
    expect((screen.getByLabelText(/maximum replicas/i) as HTMLInputElement).value).toBe('5');
    fireEvent.change(screen.getByLabelText(/maximum replicas/i), { target: { value: '2' } });
    expect((screen.getByLabelText(/minimum replicas/i) as HTMLInputElement).value).toBe('2');
  });
});

describe('ProjectScalePage, while the status loads', () => {
  it('claims nothing about the plan or the deploys', () => {
    // The page showed "starter plan ceiling: 2" and "Deploy the project once" on a pro tenant
    // with a live release, until the status arrived (#569).
    mockUseProjectStatus.mockReturnValue({ status: undefined, loading: true });
    mockUseDeployment.mockReturnValue({ build: undefined, loading: false, error: false });
    renderAt('/projects/demo/scale');
    expect(screen.getByText(/loading the scale settings/i)).toBeInTheDocument();
    expect(screen.queryAllByText(/plan ceiling/i)).toEqual([]);
    expect(screen.queryAllByText(/deploy the project once/i)).toEqual([]);
  });

  it('waits for the build before saying no app can be scaled', () => {
    mockUseProjectStatus.mockReturnValue({
      status: status({ plan_tier: 'pro', active_release: { id: 'r1', build_id: 'build-1', status: 'ACTIVE', created_at: '' } }),
    });
    mockUseDeployment.mockReturnValue({ build: undefined, loading: true, error: false });
    renderAt('/projects/demo/scale');
    expect(screen.queryAllByText(/deploy the project once/i)).toEqual([]);
    expect(screen.getByRole('button', { name: /apply scale/i })).toBeDisabled();
  });
});

