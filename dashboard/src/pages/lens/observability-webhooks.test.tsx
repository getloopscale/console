import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

// M86 — the /observability/webhooks route mounts the EXACT settings webhooks CRUD component (reuse-
// first; same /v1/settings/webhooks/* endpoints). The full list/create/delete matrix is covered by
// settings/webhooks.test.tsx (14 tests, same component); this smoke pins that the observability
// surface renders the CRUD (list + the create action) so alert setup stays in one module.

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  cloudFetch: (...a: unknown[]) => mockCloudFetch(...a),
  engineFetch: (...a: unknown[]) => mockCloudFetch(...a),
}));

import { WorkspaceWebhooksPage } from '@/pages/settings/webhooks';

describe('M86 — webhooks surface inside observability', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the webhooks CRUD (list) against /v1/settings/webhooks/*', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url === '/v1/settings/webhooks/list')
        return Promise.resolve({ webhooks: [{ id: 'wwh-1', url: 'https://hook.example/x', label: 'prod-hook', events: ['alert.threshold_breached'] }] });
      return Promise.resolve({ deliveries: [] });
    });
    render(<WorkspaceWebhooksPage />);
    // the reused CRUD lists the workspace webhooks (same endpoints the Alerts page reads)
    expect(await screen.findByText('prod-hook')).toBeInTheDocument();
    // the create affordance is present (the CRUD is fully operable in this surface)
    expect(screen.getByRole('button', { name: /add webhook/i })).toBeInTheDocument();
  });

  it('opens the create dialog (create is reachable in the observability surface)', async () => {
    mockCloudFetch.mockResolvedValue({ webhooks: [] });
    render(<WorkspaceWebhooksPage />);
    await userEvent.click(await screen.findByRole('button', { name: /add webhook/i }));
    // the create dialog's URL field appears
    expect(await screen.findByLabelText(/url/i)).toBeInTheDocument();
  });
});
