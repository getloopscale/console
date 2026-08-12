import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

// M86 — the /observability/webhooks route mounts the EXACT settings webhooks CRUD component (reuse-
// first; same /v1/settings/webhooks/* endpoints) with `context="observability"`. The full
// list/create/delete matrix is covered by settings/webhooks.test.tsx (same component); this smoke pins
// that the observability surface renders the CRUD (list + create) AND that its copy is honest for the
// alert context (no deploy "coming soon" banner; the alert event is offered).

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({
  cloudFetch: (...a: unknown[]) => mockCloudFetch(...a),
  engineFetch: (...a: unknown[]) => mockCloudFetch(...a),
}));

import { WorkspaceWebhooksPage } from '@/pages/settings/webhooks';
import { isPath } from '@/test/url';

describe('M86 — webhooks surface inside observability', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the webhooks CRUD (list) against /v1/settings/webhooks/*', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (isPath(url, '/v1/settings/webhooks/list'))
        return Promise.resolve({ webhooks: [{ id: 'wwh-1', url: 'https://hook.example/x', label: 'prod-hook', events: ['alert.threshold_breached'] }] });
      return Promise.resolve({ deliveries: [] });
    });
    render(<WorkspaceWebhooksPage context="observability" />);
    // the reused CRUD lists the workspace webhooks (same endpoints the Alerts page reads)
    expect(await screen.findByText('prod-hook')).toBeInTheDocument();
    // the create affordance is present (the CRUD is fully operable in this surface)
    expect(screen.getByRole('button', { name: /add webhook/i })).toBeInTheDocument();
  });

  it('shows HONEST alert-context copy (no deploy "coming soon"; the alert event is offered)', async () => {
    mockCloudFetch.mockResolvedValue({ webhooks: [] });
    render(<WorkspaceWebhooksPage context="observability" />);
    await screen.findByRole('button', { name: /add webhook/i });
    // the deploy-specific "Delivery coming soon" notice is FALSE for alerts (they dispatch today) → absent
    expect(screen.queryByText(/delivery coming soon/i)).not.toBeInTheDocument();
    // the create dialog offers the alert event (not deploy.*)
    await userEvent.click(screen.getByRole('button', { name: /add webhook/i }));
    expect(await screen.findByLabelText('alert.threshold_breached')).toBeInTheDocument();
    expect(screen.queryByLabelText('deploy.succeeded')).not.toBeInTheDocument();
  });

  it('the settings context still shows the deploy copy (no regression)', async () => {
    mockCloudFetch.mockResolvedValue({ webhooks: [] });
    render(<WorkspaceWebhooksPage />); // default context = settings
    expect(await screen.findByText(/delivery coming soon/i)).toBeInTheDocument();
  });

  // M91 — the delete (revoke) mutation in the OBSERVABILITY context: confirm-phrase → DELETE.
  it('M91 — delete confirms via the phrase gate then DELETEs /v1/settings/webhooks/{id}', async () => {
    mockCloudFetch.mockImplementation((url: string) =>
      isPath(url, '/v1/settings/webhooks/list')
        ? Promise.resolve({ webhooks: [{ id: 'wwh-1', url: 'https://hook.example/x', label: 'prod-hook', events: ['alert.threshold_breached'], created_at: new Date().toISOString() }] })
        : Promise.resolve(null),
    );
    render(<WorkspaceWebhooksPage context="observability" />);
    await screen.findByText('prod-hook');

    await userEvent.click(screen.getByRole('button', { name: /delete webhook prod-hook/i }));
    // the confirm is phrase-gated: type the label to enable it, then confirm.
    await userEvent.type(await screen.findByRole('textbox'), 'prod-hook');
    await userEvent.click(screen.getByRole('button', { name: /^delete webhook$/i }));

    const del = mockCloudFetch.mock.calls.find((c) => (c[1] as { method?: string })?.method === 'DELETE');
    expect(del).toBeTruthy();
    expect(String(del![0])).toBe('/v1/settings/webhooks/wwh-1');
  });

  it('M91 — a failed delete is fail-closed: the webhook is NOT removed (no fabricated/optimistic success)', async () => {
    // The list would go EMPTY only after a SUCCESSFUL delete+invalidate. A DELETE that rejects must
    // leave the webhook listed — never optimistically remove a row whose deletion did not persist.
    mockCloudFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === 'DELETE') return Promise.reject(new Error('backend 502'));
      if (isPath(url, '/v1/settings/webhooks/list'))
        return Promise.resolve({ webhooks: [{ id: 'wwh-1', url: 'https://hook.example/x', label: 'prod-hook', events: ['alert.threshold_breached'], created_at: new Date().toISOString() }] });
      return Promise.resolve(null);
    });
    render(<WorkspaceWebhooksPage context="observability" />);
    await screen.findByText('prod-hook');

    await userEvent.click(screen.getByRole('button', { name: /delete webhook prod-hook/i }));
    await userEvent.type(await screen.findByRole('textbox'), 'prod-hook');
    await userEvent.click(screen.getByRole('button', { name: /^delete webhook$/i }));

    // the DELETE was attempted…
    expect(mockCloudFetch.mock.calls.some((c) => (c[1] as { method?: string })?.method === 'DELETE')).toBe(true);
    // …and failed → the webhook is STILL listed (fail-closed; no optimistic removal without rollback).
    //
    // B-244 — this asserted `getByText('prod-hook')` and started matching TWO nodes, because the
    // dialog now stays open and echoes the label. The label is no longer a witness for "still
    // listed"; the URL is, since only the table row renders it. Widening this to `getAllByText`
    // would have kept it green while measuring nothing — the row could vanish and the dialog's own
    // copy would satisfy it.
    expect(screen.getByText('https://hook.example/x')).toBeInTheDocument();
    // And the half that was missing: the user is TOLD. Before, `revoke.mutate` swallowed the
    // rejection and the dialog closed over a delete that never happened — fail-closed in the data
    // and fail-open in what the screen claimed.
    expect(await screen.findByText('backend 502')).toBeInTheDocument();
  });
});
