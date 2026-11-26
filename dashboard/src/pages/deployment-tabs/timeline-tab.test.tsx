import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/deploy/use-deployment', () => ({
  useDeployment: vi.fn(),
}));
vi.mock('@/pages/deploy/components/build-timeline-live', () => ({
  BuildTimelineLive: vi.fn(() => null),
}));

import { useDeployment } from '@/hooks/deploy/use-deployment';
import { BuildTimelineLive } from '@/pages/deploy/components/build-timeline-live';
import { TimelineTab } from './timeline-tab';

function renderTab() {
  return render(
    <MemoryRouter initialEntries={['/projects/shop/deployments/build-1']}>
      <Routes>
        <Route path="/projects/:name/deployments/:id" element={<TimelineTab />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TimelineTab', () => {
  // The API answers the status in capitals; the timeline needs it to know the build ended.
  it("passes the build's status to the timeline", () => {
    vi.mocked(useDeployment).mockReturnValue({
      build: { build_id: 'build-1', status: 'SUCCEEDED' },
      loading: false,
      error: null,
    } as unknown as ReturnType<typeof useDeployment>);

    renderTab();

    expect(vi.mocked(BuildTimelineLive).mock.calls[0][0]).toMatchObject({
      buildId: 'build-1',
      projectName: 'shop',
      restBuildStatus: 'succeeded',
    });
  });
});
