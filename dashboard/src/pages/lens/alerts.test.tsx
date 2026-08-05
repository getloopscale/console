import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { waitFor } from '@testing-library/react';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensAlertsPage, alertSeverity } from './alerts';

describe('alertSeverity (honest status → Severity)', () => {
  it('a firing rule is alert, a cleared rule is ok', () => {
    // SeverityBadge maps alert→destructive, ok→success (verified in @usetheo/ui).
    expect(alertSeverity('TRIGGERED', true)).toBe('alert');
    expect(alertSeverity('OK', true)).toBe('ok');
  });
  it('a disabled rule is paused (inert/neutral), NOT a green ok', () => {
    // the bug: `status !== 'TRIGGERED' ? 'success'` painted a disabled/unknown rule green.
    expect(alertSeverity('OK', false)).toBe('paused');
    expect(alertSeverity('TRIGGERED', false)).toBe('paused');
  });
  it('an unknown status is unknown (neutral), never a fabricated ok', () => {
    expect(alertSeverity('PENDING', true)).toBe('unknown');
    expect(alertSeverity('', true)).toBe('unknown');
  });
});

const RULES = '/v1/dashboard/lens/alert-rules';
const WEBHOOKS = '/v1/settings/webhooks/list';

function mockRoutes(opts: { rules?: unknown[]; webhooks?: unknown[] } = {}) {
  mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
    if (url === RULES && (!init || init.method === undefined)) return Promise.resolve({ alert_rules: opts.rules ?? [] });
    if (url === WEBHOOKS) return Promise.resolve({ webhooks: opts.webhooks ?? [{ id: 'wwh-1', label: 'prod hook' }] });
    if (url === RULES && init?.method === 'POST') return Promise.resolve({ id: 'lar-new', name: 'x', status: 'OK' });
    if (url.startsWith(`${RULES}/`) && init?.method === 'DELETE') return Promise.resolve({});
    if (url.startsWith(`${RULES}/`) && init?.method === 'PATCH') return Promise.resolve({});
    return Promise.resolve({});
  });
}
const calls = (method: string) =>
  mockCloudFetch.mock.calls.filter((c) => typeof c[0] === 'string' && (c[0] as string).includes('/alert-rules') && (c[1] as { method?: string })?.method === method);

describe('LensAlertsPage (M53)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists rules with a status badge (TRIGGERED)', async () => {
    mockRoutes({
      rules: [
        { id: 'lar-1', name: 'high errors', metric: 'error_rate', comparator: 'gt', threshold: 5, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'TRIGGERED', last_evaluated_at: null, last_triggered_at: '2026-07-04T10:00:00Z' },
      ],
    });
    render(<LensAlertsPage />);
    expect(await screen.findByText('high errors')).toBeInTheDocument();
    expect(screen.getByText('TRIGGERED')).toBeInTheDocument();
  });

  it('empty state when no rules', async () => {
    mockRoutes({ rules: [] });
    render(<LensAlertsPage />);
    expect(await screen.findByText(/no alert rules yet/i)).toBeInTheDocument();
  });

  it('M84 — a rule row expands its firing history (value vs threshold, when)', async () => {
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === RULES && (!init || init.method === undefined))
        return Promise.resolve({ alert_rules: [{ id: 'lar-1', name: 'high errors', metric: 'error_rate', comparator: 'gt', threshold: 5, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'TRIGGERED', last_evaluated_at: null, last_triggered_at: '2026-07-04T10:00:00Z' }] });
      if (url === WEBHOOKS) return Promise.resolve({ webhooks: [{ id: 'wwh-1', label: 'prod' }] });
      if (url.includes('/history'))
        return Promise.resolve({ firings: [{ id: 'lfa-1', metric: 'error_rate', comparator: 'gt', threshold: 5, value: 12, fired_at: '2026-07-04T10:00:00Z' }], total: 1, limit: 20, offset: 0 });
      return Promise.resolve({});
    });
    render(<LensAlertsPage />);
    await screen.findByText('high errors');
    await userEvent.click(screen.getByRole('button', { name: /history for high errors/i }));
    await waitFor(() => expect(mockCloudFetch.mock.calls.some((c) => String(c[0]).includes('/alert-rules/lar-1/history'))).toBe(true));
    expect(await screen.findByText(/12/)).toBeInTheDocument();
  });

  it('M84 — a rule that never fired shows an honest "never fired" empty, not a fabricated row', async () => {
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === RULES && (!init || init.method === undefined))
        return Promise.resolve({ alert_rules: [{ id: 'lar-1', name: 'quiet', metric: 'cost', comparator: 'gt', threshold: 5, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'OK', last_evaluated_at: null, last_triggered_at: null }] });
      if (url === WEBHOOKS) return Promise.resolve({ webhooks: [{ id: 'wwh-1', label: 'prod' }] });
      if (url.includes('/history')) return Promise.resolve({ firings: [], total: 0, limit: 20, offset: 0 });
      return Promise.resolve({});
    });
    render(<LensAlertsPage />);
    await screen.findByText('quiet');
    await userEvent.click(screen.getByRole('button', { name: /history for quiet/i }));
    expect(await screen.findByText(/never fired/i)).toBeInTheDocument();
  });

  it('M84 — a failed history load fails closed to a typed alert (not an empty "never fired")', async () => {
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === RULES && (!init || init.method === undefined))
        return Promise.resolve({ alert_rules: [{ id: 'lar-1', name: 'boom', metric: 'cost', comparator: 'gt', threshold: 5, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'OK', last_evaluated_at: null, last_triggered_at: null }] });
      if (url === WEBHOOKS) return Promise.resolve({ webhooks: [{ id: 'wwh-1', label: 'prod' }] });
      if (url.includes('/history')) return Promise.reject(Object.assign(new Error('boom'), { status: 500 }));
      return Promise.resolve({});
    });
    render(<LensAlertsPage />);
    await screen.findByText('boom');
    await userEvent.click(screen.getByRole('button', { name: /history for boom/i }));
    expect(await screen.findByText(/could not load .*history/i)).toBeInTheDocument();
    expect(screen.queryByText(/never fired/i)).not.toBeInTheDocument();
  });

  it('discloses "register a webhook first" when the workspace has none', async () => {
    mockRoutes({ webhooks: [] });
    render(<LensAlertsPage />);
    expect(await screen.findByText(/register a webhook first/i)).toBeInTheDocument();
    // #175: the instruction BODY renders (how to register), not just the title.
    expect(screen.getByText(/add one under/i)).toBeInTheDocument();
    // M86: the prerequisite points at the IN-OBSERVABILITY webhooks surface, so alert setup stays in
    // one module (no jump to /settings/webhooks).
    expect(screen.getByRole('link', { name: /webhooks/i })).toHaveAttribute('href', '/observability/webhooks');
  });

  it('creates a rule (POST metric/comparator/threshold/window/webhook_id)', async () => {
    mockRoutes({});
    render(<LensAlertsPage />);
    await screen.findByRole('button', { name: /create rule/i });
    await userEvent.type(screen.getByLabelText(/rule name/i), 'high errors');
    await userEvent.type(screen.getByLabelText(/^threshold$/i), '5');
    // pick the webhook (Radix Select)
    await userEvent.click(screen.getByRole('combobox', { name: /notify webhook/i }));
    await userEvent.click(await screen.findByRole('option', { name: /prod hook/i }));
    await userEvent.click(screen.getByRole('button', { name: /create rule/i }));
    await waitFor(() => expect(calls('POST').length).toBe(1));
    const body = JSON.parse((calls('POST')[0][1] as { body: string }).body);
    expect(body).toMatchObject({ name: 'high errors', metric: 'error_rate', comparator: 'gt', threshold: 5, webhook_id: 'wwh-1' });
    expect(body.window_seconds).toBe(3600);
  });

  it('create is disabled until name, threshold and webhook are set', async () => {
    mockRoutes({});
    render(<LensAlertsPage />);
    await screen.findByRole('button', { name: /create rule/i });
    expect(screen.getByRole('button', { name: /create rule/i })).toBeDisabled();
  });

  it('M72 — a failed toggle surfaces a write-error Alert (not silent)', async () => {
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === RULES && (!init || init.method === undefined))
        return Promise.resolve({ alert_rules: [{ id: 'lar-1', name: 'r', metric: 'cost', comparator: 'gt', threshold: 1, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'OK', last_evaluated_at: null, last_triggered_at: null }] });
      if (url === WEBHOOKS) return Promise.resolve({ webhooks: [{ id: 'wwh-1', label: 'h' }] });
      if (url.startsWith(`${RULES}/`) && init?.method === 'PATCH')
        return Promise.reject(Object.assign(new Error('boom'), { status: 403 }));
      return Promise.resolve({});
    });
    render(<LensAlertsPage />);
    await screen.findByText('r');
    await userEvent.click(screen.getByRole('button', { name: /toggle r/i }));
    expect(await screen.findByTestId('alerts-write-error')).toBeInTheDocument();
    expect(screen.getByText(/could not toggle the alert rule/i)).toBeInTheDocument();
  });

  it('toggles a rule enabled (PATCH)', async () => {
    mockRoutes({ rules: [{ id: 'lar-1', name: 'r', metric: 'cost', comparator: 'gt', threshold: 1, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'OK', last_evaluated_at: null, last_triggered_at: null }] });
    render(<LensAlertsPage />);
    await screen.findByText('r');
    // M71 — the enable toggle exposes its state via aria-pressed (an enabled rule → pressed)
    expect(screen.getByRole('button', { name: /toggle r/i })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /toggle r/i }));
    await waitFor(() => expect(calls('PATCH').length).toBe(1));
    expect(JSON.parse((calls('PATCH')[0][1] as { body: string }).body)).toEqual({ enabled: false });
  });

  it('M98 — the toggle flips OPTIMISTICALLY before the PATCH resolves (no stale RTT gap)', async () => {
    let resolvePatch!: () => void;
    const rule = { id: 'lar-1', name: 'r', metric: 'cost', comparator: 'gt', threshold: 1, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'OK', last_evaluated_at: null, last_triggered_at: null };
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === RULES && (!init || init.method === undefined)) return Promise.resolve({ alert_rules: [rule] });
      if (url === WEBHOOKS) return Promise.resolve({ webhooks: [{ id: 'wwh-1', label: 'prod hook' }] });
      if (url.startsWith(`${RULES}/`) && init?.method === 'PATCH') return new Promise<void>((res) => (resolvePatch = res));
      return Promise.resolve({});
    });
    render(<LensAlertsPage />);
    await screen.findByText('r');
    const btn = screen.getByRole('button', { name: /toggle r/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(btn);
    // optimistic: aria-pressed flips to false + the button is disabled WHILE the PATCH is still pending
    await waitFor(() => expect(screen.getByRole('button', { name: /toggle r/i })).toHaveAttribute('aria-pressed', 'false'));
    expect(screen.getByRole('button', { name: /toggle r/i })).toBeDisabled();
    resolvePatch();
  });

  it('M98 — a failed toggle ROLLS BACK the optimistic flip (never diverges from the server)', async () => {
    const rule = { id: 'lar-1', name: 'r', metric: 'cost', comparator: 'gt', threshold: 1, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'OK', last_evaluated_at: null, last_triggered_at: null };
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === RULES && (!init || init.method === undefined)) return Promise.resolve({ alert_rules: [rule] });
      if (url === WEBHOOKS) return Promise.resolve({ webhooks: [{ id: 'wwh-1', label: 'prod hook' }] });
      if (url.startsWith(`${RULES}/`) && init?.method === 'PATCH') return Promise.reject(Object.assign(new Error('boom'), { status: 500 }));
      return Promise.resolve({});
    });
    render(<LensAlertsPage />);
    await screen.findByText('r');
    await userEvent.click(screen.getByRole('button', { name: /toggle r/i }));
    // after the failed PATCH, aria-pressed reverts to true (rolled back to the server truth)
    await waitFor(() => expect(screen.getByRole('button', { name: /toggle r/i })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('deletes a rule after confirmation (DELETE)', async () => {
    mockRoutes({ rules: [{ id: 'lar-9', name: 'junk', metric: 'cost', comparator: 'gt', threshold: 1, window_seconds: 3600, webhook_id: 'wwh-1', enabled: true, status: 'OK', last_evaluated_at: null, last_triggered_at: null }] });
    render(<LensAlertsPage />);
    await screen.findByText('junk');
    await userEvent.click(screen.getByRole('button', { name: /delete junk/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^delete rule$/i }));
    await waitFor(() => expect(calls('DELETE').length).toBe(1));
    expect(calls('DELETE')[0][0]).toContain('/alert-rules/lar-9');
  });
});

// ── M22 — a métrica escopada a um prompt ────────────────────────────────────────────────────────
//
// A `v0.83.0` liberou `prompt_resolutions` no backend, e o `Select` desta tela era fechado sobre
// três opções: a capacidade existia e era inalcançável sem `curl` (`usetheoai/theo-cloud#459`).
//
// A tela é COMPARTILHADA — é o risco #1 do milestone. Metade destes testes é regressão: alargar
// não pode estreitar o que já servia.

const USAGE = (nome: string) => `/v1/dashboard/promptly/prompts/${nome}/usage?windowDays=1`;

describe('LensAlertsPage — M22, a métrica de prompt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('oferece a métrica de prompt no seletor', async () => {
    mockRoutes({ rules: [] });
    render(<LensAlertsPage />);
    await screen.findByRole('combobox', { name: /Metric/i });
    await userEvent.click(screen.getByRole('combobox', { name: /Metric/i }));
    expect(await screen.findByRole('option', { name: /prompt/i })).toBeInTheDocument();
  });

  it('as TRÊS métricas de workspace seguem oferecidas — regressão', async () => {
    // O risco #1 registrado: a tela é compartilhada, e a quarta métrica não pode custar as outras.
    mockRoutes({ rules: [] });
    render(<LensAlertsPage />);
    await screen.findByRole('combobox', { name: /Metric/i });
    await userEvent.click(screen.getByRole('combobox', { name: /Metric/i }));
    for (const rotulo of [/error rate/i, /cost/i, /latency/i]) {
      expect(await screen.findByRole('option', { name: rotulo })).toBeInTheDocument();
    }
  });

  it('o campo de prompt aparece SÓ com a métrica de prompt', async () => {
    // O par inválido é irrepresentável no banco; um formulário que permite montá-lo só empurra a
    // recusa para depois do clique.
    mockRoutes({ rules: [] });
    render(<LensAlertsPage />);
    await screen.findByRole('combobox', { name: /Metric/i });
    expect(screen.queryByLabelText(/Prompt/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('combobox', { name: /Metric/i }));
    await userEvent.click(await screen.findByRole('option', { name: /prompt/i }));
    expect(await screen.findByLabelText(/Prompt/i)).toBeInTheDocument();
  });

  it('não deixa criar a regra de prompt sem o nome do prompt', async () => {
    mockRoutes({ rules: [] });
    render(<LensAlertsPage />);
    await screen.findByRole('combobox', { name: /Metric/i });
    await userEvent.click(screen.getByRole('combobox', { name: /Metric/i }));
    await userEvent.click(await screen.findByRole('option', { name: /prompt/i }));

    await userEvent.type(screen.getByLabelText(/Rule name/i), 'uso da saudação');
    await userEvent.type(screen.getByLabelText(/Threshold/i), '3');
    await userEvent.click(screen.getByRole('combobox', { name: /Notify webhook/i }));
    await userEvent.click(await screen.findByRole('option', { name: /prod hook/i }));

    expect(screen.getByRole('button', { name: /create rule/i })).toBeDisabled();
  });

  it('cria a regra de prompt com prompt_name no corpo', async () => {
    mockRoutes({ rules: [] });
    render(<LensAlertsPage />);
    await screen.findByRole('combobox', { name: /Metric/i });
    await userEvent.click(screen.getByRole('combobox', { name: /Metric/i }));
    await userEvent.click(await screen.findByRole('option', { name: /prompt/i }));

    await userEvent.type(screen.getByLabelText(/Rule name/i), 'uso da saudação');
    await userEvent.type(screen.getByLabelText(/Prompt/i), 'saudacao');
    await userEvent.type(screen.getByLabelText(/Threshold/i), '3');
    await userEvent.click(screen.getByRole('combobox', { name: /Notify webhook/i }));
    await userEvent.click(await screen.findByRole('option', { name: /prod hook/i }));
    await userEvent.click(screen.getByRole('button', { name: /create rule/i }));

    await waitFor(() => expect(calls('POST').length).toBe(1));
    const corpo = JSON.parse((calls('POST')[0][1] as { body: string }).body);
    expect(corpo.metric).toBe('prompt_resolutions');
    expect(corpo.prompt_name).toBe('saudacao');
  });

  it('NÃO envia prompt_name numa métrica de workspace — regressão', async () => {
    // O CHECK de pareamento vale nos dois sentidos: mandar o campo aqui faz o backend recusar.
    mockRoutes({ rules: [] });
    render(<LensAlertsPage />);
    await screen.findByLabelText(/Rule name/i);
    await userEvent.type(screen.getByLabelText(/Rule name/i), 'erro geral');
    await userEvent.type(screen.getByLabelText(/Threshold/i), '5');
    await userEvent.click(screen.getByRole('combobox', { name: /Notify webhook/i }));
    await userEvent.click(await screen.findByRole('option', { name: /prod hook/i }));
    await userEvent.click(screen.getByRole('button', { name: /create rule/i }));

    await waitFor(() => expect(calls('POST').length).toBe(1));
    const corpo = JSON.parse((calls('POST')[0][1] as { body: string }).body);
    expect(corpo.metric).toBe('error_rate');
    expect(corpo).not.toHaveProperty('prompt_name');
  });

  it('mostra o valor MEDIDO agora ao lado do limiar', async () => {
    // Risco #2: um limite escolhido às cegas é o alerta mal calibrado que o M21 nomeia. A tela
    // lê o mesmo agregado que a aba de produção mostra.
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === RULES && (!init || init.method === undefined)) return Promise.resolve({ alert_rules: [] });
      if (url === WEBHOOKS) return Promise.resolve({ webhooks: [{ id: 'wwh-1', label: 'prod hook' }] });
      if (url === USAGE('saudacao')) return Promise.resolve({ rows: [{ revision: 6, resolutions: 42 }] });
      return Promise.resolve({});
    });
    render(<LensAlertsPage />);
    await screen.findByRole('combobox', { name: /Metric/i });
    await userEvent.click(screen.getByRole('combobox', { name: /Metric/i }));
    await userEvent.click(await screen.findByRole('option', { name: /prompt/i }));
    await userEvent.type(screen.getByLabelText(/Prompt/i), 'saudacao');

    expect(await screen.findByText(/42/)).toBeInTheDocument();
  });

  it('falha ao ler o valor medido NÃO vira zero', async () => {
    // A regra do M13/M15: falha de leitura nunca é renderizada como ausência de dado — e um `0`
    // fabricado ao lado do campo de limiar convidaria ao limite errado.
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === RULES && (!init || init.method === undefined)) return Promise.resolve({ alert_rules: [] });
      if (url === WEBHOOKS) return Promise.resolve({ webhooks: [{ id: 'wwh-1', label: 'prod hook' }] });
      if (url === USAGE('saudacao')) return Promise.reject(new Error('lens fora do ar'));
      return Promise.resolve({});
    });
    render(<LensAlertsPage />);
    await screen.findByRole('combobox', { name: /Metric/i });
    await userEvent.click(screen.getByRole('combobox', { name: /Metric/i }));
    await userEvent.click(await screen.findByRole('option', { name: /prompt/i }));
    await userEvent.type(screen.getByLabelText(/Prompt/i), 'saudacao');

    expect(await screen.findByText(/não foi possível|could not read/i)).toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });
});

describe('LensAlertsPage — M22, o formulário ensina em vez de ralhar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('não acusa o campo de prompt antes de o operador tocá-lo', async () => {
    // O formulário abre vazio porque esse é o estado inicial legítimo, não um engano dele.
    // Acusar antes do primeiro toque transforma a tela de partida numa tela de erro.
    mockRoutes({ rules: [] });
    render(<LensAlertsPage />);
    await screen.findByRole('combobox', { name: /Metric/i });
    await userEvent.click(screen.getByRole('combobox', { name: /Metric/i }));
    await userEvent.click(await screen.findByRole('option', { name: /prompt/i }));

    expect(screen.queryByText(/Diga qual prompt/i)).not.toBeInTheDocument();
  });

  it('DIZ por que não dá para criar, depois de tocar o campo', async () => {
    // Um botão desabilitado sem explicação viola `DESIGN.md § 6` (erros como diagnóstico): o
    // operador vê que não pode criar e não descobre o que falta.
    mockRoutes({ rules: [] });
    render(<LensAlertsPage />);
    await screen.findByRole('combobox', { name: /Metric/i });
    await userEvent.click(screen.getByRole('combobox', { name: /Metric/i }));
    await userEvent.click(await screen.findByRole('option', { name: /prompt/i }));

    const campo = await screen.findByLabelText(/^Prompt$/i);
    await userEvent.type(campo, 'x');
    await userEvent.clear(campo); // tocado, e agora vazio

    expect(await screen.findByText(/Diga qual prompt/i)).toBeInTheDocument();
  });
});
