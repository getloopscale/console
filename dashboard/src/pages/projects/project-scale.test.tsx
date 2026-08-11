import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/render';
import { Routes, Route } from 'react-router-dom';
import type { ProjectStatusDetail } from '@/lib/api/types';

// M15 T1: the Scale page must show the REAL current replica count from the
// project status, not the hardcoded DEFAULT_CURRENT_REPLICAS=2.

const mockUseProjectStatus = vi.fn();
vi.mock('@/hooks/use-project-status', () => ({
  useProjectStatus: () => mockUseProjectStatus(),
}));
vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => undefined }));
vi.mock('@/hooks/projects/use-scale', () => ({
  useScale: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null, data: undefined }),
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

describe('ProjectScalePage — real current replicas (M15 T1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('seeds the current replica count from status.scaling.replicas (not a hardcoded 2)', () => {
    mockUseProjectStatus.mockReturnValue({
      status: status({ plan_tier: 'pro', scaling: { replicas: 10, min: 1, max: 20, scaled_to_zero: false } }),
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

  it('falls back to the default only when the project has no release yet', () => {
    mockUseProjectStatus.mockReturnValue({ status: status({ plan_tier: 'starter' }) });
    renderAt('/projects/demo/scale');
    // No real replica signal → the neutral default (2) is acceptable here.
    expect(screen.getAllByText(/2 replicas/).length).toBeGreaterThanOrEqual(1);
  });
});
