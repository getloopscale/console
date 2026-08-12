// J-16 Settings › Webhooks — registration-only v0.1 acceptance.
// Mirrors the memory/webhooks test harness (mocked cloudFetch + @/test/render).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen, waitFor } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({
    active: true,
    identity: { id: 't', traits: { email: 'u@x.com' } },
  }),
}));

const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({
  cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
  engineFetch: (...args: unknown[]) => mockCloudFetch(...args),
}));

import { WorkspaceWebhooksPage } from './webhooks';
import { isPath } from '@/test/url';

describe('WorkspaceWebhooksPage (/settings/webhooks)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discloses registration-only state with a persistent "Delivery coming soon" Alert', async () => {
    mockCloudFetch.mockResolvedValueOnce({ webhooks: [] });
    render(<WorkspaceWebhooksPage />);
    // Honesty (Rule 3): the customer is told delivery is not live yet.
    expect(await screen.findByText('Delivery coming soon')).toBeInTheDocument();
    expect(document.body).toHaveTextContent(/no events are dispatched/i);
  });

  it('empty state prompts adding the first webhook', async () => {
    mockCloudFetch.mockResolvedValueOnce({ webhooks: [] });
    render(<WorkspaceWebhooksPage />);
    expect(await screen.findByText(/no webhooks yet/i)).toBeInTheDocument();
  });

  it('lists registered webhooks from /v1/settings/webhooks/list', async () => {
    mockCloudFetch.mockResolvedValueOnce({
      webhooks: [
        {
          id: 'wwh-0011223344556677',
          url: 'https://hook.example.com/deploys',
          label: 'prod-deploys',
          events: ['deploy.succeeded', 'deploy.failed'],
          created_at: new Date().toISOString(),
        },
      ],
    });
    render(<WorkspaceWebhooksPage />);
    expect(await screen.findByText('prod-deploys')).toBeInTheDocument();
    expect(screen.getByText('https://hook.example.com/deploys')).toBeInTheDocument();
    expect(screen.getByText('deploy.succeeded')).toBeInTheDocument();
    // List query hits the settings endpoint (not the memory one).
    // #274 — a leitura passou a optar por `throwOnError`, então a chamada tem 3 argumentos. A
    // assertiva afirma o TERCEIRO em vez de ignorá-lo: sem isso, um futuro que remova o opt-in
    // deixaria este teste verde de novo, e o estado vazio voltaria a mentir.
    expect(mockCloudFetch).toHaveBeenCalledWith(expect.stringContaining('/v1/settings/webhooks/list'), expect.anything(), expect.objectContaining({ throwOnError: true }));
  });

  it('create shows the signing secret exactly once (show-once contract)', async () => {
    const user = userEvent.setup();
    mockCloudFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (String(path) === '/v1/settings/webhooks' && opts?.method === 'POST') {
        return Promise.resolve({
          id: 'wwh-aaaa1111bbbb2222',
          url: 'https://hook.example.com/deploys',
          label: 'prod-deploys',
          events: ['deploy.succeeded'],
          secret: 'whsec_ThisIsShownOnlyOnce_abc123',
        });
      }
      return Promise.resolve({ webhooks: [] });
    });
    render(<WorkspaceWebhooksPage />);
    await screen.findByText(/no webhooks yet/i);

    await user.click(screen.getByRole('button', { name: /add webhook/i }));
    await user.type(screen.getByPlaceholderText(/hook\.example\.com/i), 'https://hook.example.com/deploys');
    await user.type(screen.getByPlaceholderText('prod-deploys'), 'prod-deploys');
    // deploy.succeeded is preselected; submit.
    await user.click(screen.getByRole('button', { name: /^add webhook$/i }));

    // Secret surfaces once, in the show-once dialog.
    const secret = await screen.findByTestId('webhook-signing-secret');
    expect(secret).toHaveTextContent('whsec_ThisIsShownOnlyOnce_abc123');
    expect(screen.getByText(/will not be shown again/i)).toBeInTheDocument();
  });

  it('view-deliveries opens a sheet that lists the webhook delivery history', async () => {
    const user = userEvent.setup();
    mockCloudFetch.mockImplementation((path: string) => {
      if (isPath(path, '/v1/settings/webhooks/list')) {
        return Promise.resolve({
          webhooks: [
            {
              id: 'wwh-0011223344556677',
              url: 'https://hook.example.com/deploys',
              label: 'prod-deploys',
              events: ['deploy.succeeded'],
              created_at: new Date().toISOString(),
            },
          ],
        });
      }
      if (String(path).includes('/deliveries')) {
        return Promise.resolve({
          deliveries: [
            {
              id: 'wwd-1',
              event_type: 'deploy.succeeded',
              status: 'delivered',
              attempt_count: 1,
              last_response_status: 200,
              created_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
            },
          ],
        });
      }
      return Promise.resolve({ deliveries: [] });
    });
    render(<WorkspaceWebhooksPage />);
    await screen.findByText('prod-deploys');

    await user.click(screen.getByRole('button', { name: /view deliveries for prod-deploys/i }));

    // The sheet fetches from the scoped endpoint and renders the delivery.
    expect(await screen.findByTestId('delivery-wwd-1')).toBeInTheDocument();
    expect(mockCloudFetch).toHaveBeenCalledWith('/v1/settings/webhooks/wwh-0011223344556677/deliveries', expect.anything(), expect.objectContaining({ throwOnError: true }));
  });

  it('delete opens a destructive confirm dialog scoped to the webhook label', async () => {
    const user = userEvent.setup();
    mockCloudFetch.mockResolvedValue({
      webhooks: [
        {
          id: 'wwh-0011223344556677',
          url: 'https://hook.example.com/deploys',
          label: 'prod-deploys',
          events: ['deploy.succeeded'],
          created_at: new Date().toISOString(),
        },
      ],
    });
    render(<WorkspaceWebhooksPage />);
    await screen.findByText('prod-deploys');

    await user.click(screen.getByRole('button', { name: /delete webhook prod-deploys/i }));
    await waitFor(() => {
      expect(screen.getByText(/delete webhook "prod-deploys"\?/i)).toBeInTheDocument();
    });
  });
});
