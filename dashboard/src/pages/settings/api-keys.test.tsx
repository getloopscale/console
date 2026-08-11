// Plan 0 of dashboard-memory-section-roadmap.md, T0.1 acceptance gate.
// Focused on the EC-13 absorption: "I've copied my key safely" Checkbox
// MUST gate the Close (Done) button on the show-once secret dialog. If a
// future refactor breaks this gate, the customer can dismiss the dialog
// without copying — and the secret is unrecoverable.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({
    active: true,
    identity: { id: 'test', traits: { email: 'u@x.com' } },
  }),
}));

const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({
  cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
  engineFetch: (...args: unknown[]) => mockCloudFetch(...args),
}));

import { ApiKeysPage } from './api-keys';

describe('ApiKeysPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no keys exist', async () => {
    mockCloudFetch.mockResolvedValueOnce({ keys: [] });
    render(<ApiKeysPage />);
    expect(await screen.findByText(/No API keys yet/i)).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /create api key/i }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('lists keys with masked prefix + scope badges', async () => {
    mockCloudFetch.mockResolvedValueOnce({
      keys: [
        {
          id: 'apk-1111111111111111',
          name: 'prod-agent',
          key_prefix: 'theo_live_Ab',
          scopes: ['memory:read', 'memory:write'],
          created_at: new Date().toISOString(),
        },
      ],
    });
    render(<ApiKeysPage />);
    expect(await screen.findByText('prod-agent')).toBeInTheDocument();
    expect(screen.getByText(/theo_live_Ab…/)).toBeInTheDocument();
    expect(screen.getByText('memory:read')).toBeInTheDocument();
    expect(screen.getByText('memory:write')).toBeInTheDocument();
  });

  // =============================================================================
  // API Key Rotation plan T6.5 — Rotate button + ConfirmDialog + show-once reveal
  // =============================================================================

  it('T6.5 — Rotate button per row opens ConfirmDialog with grace-window copy', async () => {
    mockCloudFetch.mockResolvedValueOnce({
      keys: [
        {
          id: 'apk-1111111111111111',
          name: 'prod-agent',
          key_prefix: 'theo_live_Ab',
          scopes: ['memory:read', 'memory:write'],
          created_at: new Date().toISOString(),
        },
      ],
    });
    const user = userEvent.setup();
    render(<ApiKeysPage />);
    expect(await screen.findByText('prod-agent')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /rotate api key prod-agent/i }));
    // ConfirmDialog body explains the grace window per D2.
    expect(await screen.findByText(/keep working for 24 hours/i)).toBeInTheDocument();
    expect(screen.getByText(/overlap during the grace window/i)).toBeInTheDocument();
  });

  it('T6.5 — successful rotation triggers the show-once secret reveal', async () => {
    mockCloudFetch.mockResolvedValueOnce({
      keys: [
        {
          id: 'apk-1111111111111111',
          name: 'prod-agent',
          key_prefix: 'theo_live_Ab',
          scopes: ['memory:read'],
          created_at: new Date().toISOString(),
        },
      ],
    });
    // Second mock = the POST /v1/api-keys/{id}/rotate response.
    mockCloudFetch.mockResolvedValueOnce({
      id: 'apk-2222222222222222',
      name: 'prod-agent (rotated 2026-06-06)',
      key_prefix: 'theo_live_Xy',
      scopes: ['memory:read'],
      secret: 'theo_live_rotatedNEWsecret0123456789abcdefghij',
    });

    const user = userEvent.setup();
    render(<ApiKeysPage />);
    expect(await screen.findByText('prod-agent')).toBeInTheDocument();

    // Open rotate dialog → type confirmation → confirm.
    await user.click(screen.getByRole('button', { name: /rotate api key prod-agent/i }));
    const confirmInput = await screen.findByRole('textbox');
    await user.type(confirmInput, 'prod-agent');
    await user.click(screen.getByRole('button', { name: /rotate key/i }));

    // The new secret MUST appear in the show-once reveal dialog.
    expect(await screen.findByText(/theo_live_rotatedNEWsecret/)).toBeInTheDocument();
    // LT-019 (mesma classe do create): o `throwOnError` precisa ser o TERCEIRO argumento
    // de `cloudFetch`, não um parâmetro do `JSON.stringify` do corpo. A primeira tentativa
    // de correção o colocou como *replacer* do stringify — sintaticamente válido, ignorado
    // em runtime, e o `tsc --noEmit` passou LIMPO. Sem esta asserção, uma rotação recusada
    // voltaria a abrir o diálogo de segredo com `null` e o operador perderia a chave antiga
    // acreditando ter a nova.
    const rotateCall = mockCloudFetch.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('/rotate'),
    );
    expect(rotateCall, 'a rotação precisa POSTar em /rotate').toBeDefined();
    expect(
      (rotateCall?.[2] as { throwOnError?: boolean } | undefined)?.throwOnError,
    ).toBe(true);
  });

  it('T7.4 — Lineage button per row opens Sheet with timeline + current highlight', async () => {
    mockCloudFetch.mockImplementation((path: string) => {
      if (String(path).includes('/v1/api-keys/apk-1111111111111111/lineage')) {
        return Promise.resolve({
          lineage: [
            {
              id: 'apk-1111111111111111',
              name: 'prod-agent (root)',
              key_prefix: 'theo_live_Aa',
              created_at: new Date(Date.now() - 86400000).toISOString(),
              revoked_at: null,
              expires_at: null,
              is_current: false,
            },
            {
              id: 'apk-2222222222222222',
              name: 'prod-agent (rotated 2026-06-06)',
              key_prefix: 'theo_live_Bb',
              created_at: new Date().toISOString(),
              revoked_at: null,
              expires_at: null,
              is_current: true,
            },
          ],
        });
      }
      return Promise.resolve({
        keys: [
          {
            id: 'apk-1111111111111111',
            name: 'prod-agent',
            key_prefix: 'theo_live_Aa',
            scopes: ['memory:read'],
            created_at: new Date().toISOString(),
          },
        ],
      });
    });

    const user = userEvent.setup();
    render(<ApiKeysPage />);
    expect(await screen.findByText('prod-agent')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /view lineage for api key prod-agent/i }));

    // Sheet renders timeline with both lineage rows.
    expect(await screen.findByTestId('lineage-row-apk-1111111111111111')).toBeInTheDocument();
    expect(screen.getByTestId('lineage-row-apk-2222222222222222')).toBeInTheDocument();
    // The is_current row has the Current badge.
    expect(screen.getByTestId('lineage-current-apk-2222222222222222')).toBeInTheDocument();
    // The non-current row does NOT have the Current badge.
    expect(screen.queryByTestId('lineage-current-apk-1111111111111111')).not.toBeInTheDocument();
  });

  it('EC-13: Close button is disabled until "I\'ve copied" checkbox is checked', async () => {
    // Empty list so the page renders without table noise.
    mockCloudFetch.mockResolvedValueOnce({ keys: [] });
    // POST /v1/api-keys returns the show-once secret.
    mockCloudFetch.mockResolvedValueOnce({
      id: 'apk-2222222222222222',
      name: 'test',
      key_prefix: 'theo_live_Cd',
      scopes: ['memory:read'],
      secret: 'theo_live_CdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg',
    });

    const user = userEvent.setup();
    render(<ApiKeysPage />);

    // Open the create dialog from the empty-state CTA.
    await user.click(
      (await screen.findAllByRole('button', { name: /create api key/i }))[0],
    );
    // Name the key + submit.
    await user.type(screen.getByLabelText(/name/i), 'test');
    // #348: o diálogo não pré-marca mais escopo algum — o submit fica bloqueado até o usuário
    // escolher um. Este passo NÃO existia porque `memory:read` vinha marcado de fábrica, que é
    // exatamente o default que a tela desaconselhava em texto próprio.
    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getByRole('button', { name: /create key/i }));

    // Show-once dialog renders the secret.
    expect(
      await screen.findByText(/theo_live_CdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg/),
    ).toBeInTheDocument();

    // GUARD: "Done" button MUST be disabled before the customer ticks the box.
    const doneButton = screen.getByRole('button', { name: /^done$/i });
    expect(doneButton).toBeDisabled();
    expect(doneButton.getAttribute('aria-disabled')).toBe('true');

    // Tick the checkbox.
    await user.click(screen.getByLabelText(/i've copied my key safely/i));

    // Done becomes enabled.
    expect(doneButton).not.toBeDisabled();
  });

  it('#168: offers rag:read/write/delete as selectable ACTIVE scopes (not reserved)', async () => {
    mockCloudFetch.mockResolvedValueOnce({ keys: [] });
    const user = userEvent.setup();
    render(<ApiKeysPage />);

    // Open the create dialog.
    await user.click(
      (await screen.findAllByRole('button', { name: /create api key/i }))[0],
    );

    // rag data scopes render as SELECTABLE checkboxes (aria-label = scope id), and a
    // customer can tick one — proving they are active, not "Reserved for future surfaces".
    for (const scope of ['rag:read', 'rag:write', 'rag:delete']) {
      const box = screen.getByLabelText(scope);
      expect(box).toBeInTheDocument();
      expect(box).not.toBeDisabled();
    }
    const ragRead = screen.getByLabelText('rag:read');
    await user.click(ragRead);
    expect(ragRead).toBeChecked();

    // rag:admin is NOT customer-issuable (broker-held) — no checkbox for it.
    expect(screen.queryByLabelText('rag:admin')).not.toBeInTheDocument();
  });
  // LT-019 da corrida de live-test 2026-08-01. O red team criou uma chave pela UI
  // real, o backend devolveu 400 UNKNOWN_SCOPE, e o diálogo FECHOU como se a chave
  // tivesse sido criada — sem mensagem alguma. O operador fica convencido de que tem
  // uma credencial que não existe, e vai depurar o lugar errado.
  //
  // A superfície de erro do diálogo já existia e é correta (Alert "Could not create
  // key"). O que faltava era alimentá-la: `cloudFetch` resolve para `null` em erro a
  // menos que receba `{ throwOnError: true }` — descrito como "Opt-in" na doc do
  // próprio `@/lib/api`. O caminho de LEITURA desta página passa a flag; os de
  // MUTAÇÃO não passavam, então toda falha virava `onSuccess`.
  it('LT-019: a criação de chave pede throwOnError — sem isso o 400 vira sucesso silencioso', async () => {
    mockCloudFetch.mockResolvedValueOnce({ keys: [] });
    const user = userEvent.setup();
    render(<ApiKeysPage />);

    await user.click(
      (await screen.findAllByRole('button', { name: /create api key/i }))[0],
    );
    await user.type(screen.getByLabelText(/name/i), 'chave-lt-019');
    await user.click(screen.getAllByRole('checkbox')[0]); // #348 — escopo agora é escolha explícita
    mockCloudFetch.mockRejectedValueOnce(new Error('Scope "promptly:read" is not a known scope.'));
    await user.click(screen.getByRole('button', { name: /^create key$/i }));

    const createCall = mockCloudFetch.mock.calls.find(
      (c) => c[0] === '/v1/api-keys' && (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(createCall, 'a página precisa POSTar em /v1/api-keys').toBeDefined();
    expect(
      (createCall?.[2] as { throwOnError?: boolean } | undefined)?.throwOnError,
      'sem throwOnError o cloudFetch resolve null e o React Query chama onSuccess num 400',
    ).toBe(true);
  });

  it('LT-019: falha na criação MANTÉM o diálogo aberto e mostra a causa', async () => {
    mockCloudFetch.mockResolvedValueOnce({ keys: [] });
    const user = userEvent.setup();
    render(<ApiKeysPage />);

    await user.click(
      (await screen.findAllByRole('button', { name: /create api key/i }))[0],
    );
    await user.type(screen.getByLabelText(/name/i), 'chave-lt-019');
    await user.click(screen.getAllByRole('checkbox')[0]); // #348 — escopo agora é escolha explícita
    mockCloudFetch.mockRejectedValueOnce(new Error('Scope "promptly:read" is not a known scope.'));
    await user.click(screen.getByRole('button', { name: /^create key$/i }));

    // O diálogo NÃO pode fechar: fechar é o que faz o operador acreditar que a chave existe.
    expect(await screen.findByText(/Could not create key/i)).toBeInTheDocument();
    expect(screen.getByText(/is not a known scope/i)).toBeInTheDocument();
  });
});
