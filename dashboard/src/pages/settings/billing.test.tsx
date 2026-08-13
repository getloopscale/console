import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({
    active: true,
    identity: { id: 'test', traits: { email: 'u@x.com' } },
  }),
}));

const mockUseCloudApi = vi.fn();
vi.mock('@/hooks/use-api', () => ({
  // Sprint 3 Phase 3 (#21) — mock forwards (path, options) so the v1.1 route
  // gate (`{ enabled }`) can be observed by the new regression test below.
  useCloudApi: (path: string, options?: { enabled?: boolean }) => mockUseCloudApi(path, options),
  useEngineApi: (path: string, options?: { enabled?: boolean }) => mockUseCloudApi(path, options),
}));

// J-13: the page embeds <InvoicesCard/>, which fetches invoices via its own
// useInvoices hook. Mock it to a neutral empty state so the page tests don't
// exercise (or pollute the shared cloudFetch mock with) the invoices fetch —
// the invoice table has its own tests (components/billing/invoices-card.test.tsx).
vi.mock('@/hooks/settings/use-invoices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/settings/use-invoices')>()),
  useInvoices: () => ({ invoices: [], loading: false, forbidden: false, error: false }),
}));

const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', () => {
  // Declare ApiError inside the factory closure — vi.mock hoists, so a top-
  // level class would be in the TDZ when the mock executes (vitest error
  // "Cannot access 'ApiError' before initialization").
  class ApiError extends Error {
    readonly status: number;
    readonly body?: unknown;
    constructor(status: number, body?: unknown, message?: string) {
      super(message ?? `API request failed with status ${status}`);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  }
  return {
    cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
    engineFetch: (...args: unknown[]) => mockCloudFetch(...args),
    ApiError,
  };
});

// Import the same mocked ApiError so the test's instanceof checks line up with
// the real module's export (the production catch branch checks instanceof).
import { ApiError } from '@/lib/http/api';

import { BillingPage } from './billing';

describe('BillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_billing_renders_plan_badge_with_current_plan', () => {
    mockUseCloudApi.mockReturnValue({
      data: {
        plan: 'pro',
        team: 'acme',
        usage: {},
      },
      loading: false,
      error: false,
      isSuccess: true,
    });
    render(<BillingPage />);
    // PlanBadge + plan label both render "Pro" — assert occurrence count.
    expect(screen.getAllByText('Pro').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('acme')).toBeInTheDocument();
  });

  // qa-sprint2-cleanup-2026-06-24 T2.1 — closes theo-cloud#15
  // (BLOCKER ux_friction: Manage Plan click was inert).
  //
  // Pre-fix: handler called window.open(portal.url, '_blank') from an async
  // callback after `await cloudFetch`. Modern browsers (Chrome 119+, Safari 17+,
  // Firefox 122+) BLOCK popups opened from async callbacks because the user
  // gesture activation expires. The popup was silently suppressed.
  //
  // T2.2 fix: swap window.open → window.location.href, matching the existing
  // upgradePlan handler (which uses window.location.href correctly) and Stripe's
  // documented canonical Customer Portal pattern (same-window navigation).
  it('test_billing_portal_button_navigates_same_window_on_success', async () => {
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'pro', team: 'acme', usage: {} },
      loading: false,
      error: false,
      isSuccess: true,
    });
    mockCloudFetch.mockResolvedValue({ url: 'https://billing.stripe.com/portal/xyz' });

    // jsdom does not implement navigation; stub the location.href setter so we
    // can observe what the click handler attempted to assign.
    const hrefSetter = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: {
        ...originalLocation,
        set href(v: string) { hrefSetter(v); },
        get href() { return originalLocation.href; },
      },
    });

    // EC-11 defense: window.open MUST NOT be called post-fix (would mean the
    // async-callback popup-blocker bug is back).
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    const user = userEvent.setup();
    render(<BillingPage />);
    await user.click(screen.getByRole('button', { name: /manage plan/i }));

    // The Manage Plan handler also forwards `{ throwOnError: true }` per
    // theo-cloud#49/#69 closure so non-2xx no longer falls into the
    // silent null branch; match the path argument loosely.
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/billing/portal',
      undefined,
      expect.objectContaining({ throwOnError: true }),
    );
    expect(hrefSetter).toHaveBeenCalledWith('https://billing.stripe.com/portal/xyz');
    expect(openSpy).not.toHaveBeenCalled();

    openSpy.mockRestore();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('test_billing_portal_button_renders_alert_on_null_response', async () => {
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'pro', team: 'acme', usage: {} },
      loading: false,
      error: false,
      isSuccess: true,
    });
    // Failure path: backend returns null OR a response with no `url` field.
    mockCloudFetch.mockResolvedValue(null);

    const user = userEvent.setup();
    render(<BillingPage />);
    await user.click(screen.getByRole('button', { name: /manage plan/i }));

    // Assert a destructive Alert renders with the failure copy — proves the
    // click produces an OBSERVABLE effect even on the failure path (the
    // canonical FAANG anti-inert assertion that closes the #15 BLOCKER).
    const alert = await screen.findByRole('alert');
    expect(alert.textContent ?? '').toMatch(/failed to open billing portal/i);
  });

  // EC-5 "invoice table OMITTED" test removed at J-13 (MEET-2026-07-03-004):
  // the invoice table now ships as a separate <InvoicesCard/> with its own
  // owner-gated fetch and its own tests (components/billing/invoices-card.test.tsx).

  it('test_billing_cancel_subscription_requires_confirmation', () => {
    // BillingPage v1.2: cancel flow is delegated to Stripe Portal (no in-app cancel button).
    // Verify there is no direct cancel button — managing plan goes through portal.
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'pro', team: 'acme', usage: {} },
      loading: false,
      error: false,
      isSuccess: true,
    });
    render(<BillingPage />);
    expect(screen.queryByRole('button', { name: /cancel subscription/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manage plan/i })).toBeInTheDocument();
  });

  // B-125 — herdados da Overview, cujo painel `Usage` saiu.
  //
  // POR QUE MIGRAR EM VEZ DE APAGAR: aqueles seis casos travavam um contrato REAL — que o painel
  // ligava as chaves de billing verdadeiras (`projects`, `builds_per_month`, `environments`,
  // `seats`) e NÃO o vocabulário do mockup Vercel que nunca populou. Apagá-los junto com o painel
  // teria deixado o contrato sem guarda em qualquer tela.
  //
  // Medido antes de mover: `/billing` renderiza toda chave de `billing.usage` dinamicamente
  // (`billing.tsx:215`), então as quatro já apareciam aqui — conferido no navegador, com os mesmos
  // números que a Overview mostrava. A pergunta "quanto do meu plano eu usei" sempre foi desta
  // tela; ela só tinha uma segunda cópia na home.
  it('test_billing_usage_binds_real_backend_keys_not_vercel_mockup', () => {
    mockUseCloudApi.mockReturnValue({ data: {
      plan: 'pro',
      team: 'acme',
      usage: {
        projects: { used: 4, limit: 10 },
        builds_per_month: { used: 145, limit: 1000 },
        environments: { used: 2, limit: 3 },
        seats: { used: 3, limit: 10 },
      },
    }, loading: false, error: false });
    render(<BillingPage />);

    // `getAllByText` e não `getByText`: o `UsageMeter` renderiza o rótulo mais de uma vez (barra
    // e legenda), e exigir ocorrência única afirmaria sobre a composição do primitivo em vez de
    // sobre a chave estar ligada — que é o que este caso protege.
    for (const rotulo of ['Projects', 'Builds Per Month', 'Environments', 'Seats']) {
      expect(screen.getAllByText(rotulo).length, `${rotulo} não está ligado`).toBeGreaterThanOrEqual(1);
    }

    // As chaves fabricadas do mockup precisam continuar ausentes.
    expect(screen.queryByText('Fast Data Transfer')).not.toBeInTheDocument();
    expect(screen.queryByText('Edge Requests')).not.toBeInTheDocument();
    expect(screen.queryByText('Concurrent Builds')).not.toBeInTheDocument();
  });

  // B-242 — a âncora das três asserções acima, e a razão pela qual elas significam alguma coisa.
  //
  // Sem um caso que RENDERIZE esses rótulos, as três eram satisfeitas por dois mundos distintos:
  // o painel lendo as chaves reais (correto) e um painel que parou de renderizar rótulo nenhum
  // (defeito). Apagar o `map` de `billing.usage` deixava as três verdes.
  //
  // O que este caso prova é o invariante de que elas dependem: o rótulo é DERIVADO da chave
  // (`billing.tsx:192` — `key.replace(/_/g,' ')` com title-case), então o vocabulário do mockup
  // está ausente porque o backend não o envia, e não porque a tela o proíba por nome.
  it('test_billing_usage_labels_are_derived_from_the_key_the_backend_sends', () => {
    mockUseCloudApi.mockReturnValue({ data: {
      plan: 'pro',
      team: 'acme',
      usage: {
        fast_data_transfer: { used: 1, limit: 10 },
        edge_requests: { used: 2, limit: 20 },
        concurrent_builds: { used: 3, limit: 30 },
      },
    }, loading: false, error: false });
    render(<BillingPage />);

    // Literais e não um `for` sobre um array: o detector do B-242 lê o SELETOR, e um seletor que
    // é uma variável (`rotulo`) não ancora nada — ele não tem texto para casar com a asserção de
    // ausência lá em cima. Escrever os três por extenso é o que faz o par existir. (Foi medido:
    // com o laço, as três seguiam contadas como desancoradas.)
    expect(screen.getAllByText('Fast Data Transfer').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Edge Requests').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Concurrent Builds').length).toBeGreaterThanOrEqual(1);
  });

  it('test_billing_usage_renders_unlimited_when_limit_null', () => {
    // ADR-D1.bis: `limit: null` é o tier Enterprise, e renderiza "Unlimited" em vez de um teto
    // inventado.
    mockUseCloudApi.mockReturnValue({ data: {
      plan: 'enterprise',
      team: 'acme',
      usage: {
        projects: { used: 12, limit: null },
        seats: { used: 20, limit: null },
      },
    }, loading: false, error: false });
    render(<BillingPage />);

    expect(screen.getAllByText(/\/ Unlimited/).length).toBe(2);
  });

  it('test_billing_usage_renders_over_quota', () => {
    // EC-6: `used > limit` mostra o número REAL, não o teto. Esconder o excedente faria o
    // operador acreditar que está no limite quando já passou dele.
    mockUseCloudApi.mockReturnValue({ data: {
      plan: 'pro',
      team: 'acme',
      usage: { projects: { used: 4, limit: 3 } },
    }, loading: false, error: false });
    render(<BillingPage />);

    expect(screen.getByText(/^4 \/ 3$/)).toBeInTheDocument();
  });

  it('test_billing_usage_meter_reflects_period_data', () => {
    mockUseCloudApi.mockReturnValue({
      data: {
        plan: 'pro',
        team: 'acme',
        usage: {
          build_minutes: { used: 120, limit: 500 },
          bandwidth_mb: { used: 1000, limit: 10000 },
        },
        period_start: '2026-05-01T00:00:00Z',
        period_end: '2026-05-31T23:59:59Z',
      },
      loading: false,
      error: false,
      isSuccess: true,
    });
    render(<BillingPage />);
    expect(screen.getByText('Usage This Period')).toBeInTheDocument();
    // T-DR-1.3 v1.2: metric labels now appear in BOTH places (Plan card
    // quota Includes section + UsageMeter). Use getAllByText for ambiguity.
    expect(screen.getAllByText('Build Minutes').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Bandwidth Mb').length).toBeGreaterThanOrEqual(1);
  });

  it('test_billing_plan_card_renders_quota_summary_v12', () => {
    // T-DR-1.3 v1.2 (closes P2-1): Plan card now shows "Includes" quota
    // summary inline (drawn from billing.usage map).
    mockUseCloudApi.mockReturnValue({
      data: {
        plan: 'pro',
        team: 'acme',
        usage: {
          build_minutes: { used: 120, limit: 500 },
          bandwidth_mb: { used: 1000, limit: 10000 },
        },
      },
      loading: false,
      error: false,
      isSuccess: true,
    });
    render(<BillingPage />);
    expect(screen.getByText('Includes')).toBeInTheDocument();
  });

  it('test_billing_upsell_is_focusable_button_with_accessible_name_closes_27', () => {
    // Sprint 3 Phase 7 (#27) v1.1 ADR D4 — upsell card was a <Card onClick>
    // with <p> content (not focusable, no role). Now a real <button> wrapping
    // <Card.Body>. v1.1 EC-3: dropped <Card as="button"> polymorphic gamble
    // (the @usetheo/ui Card .d.ts has no `as`/`asChild` prop).
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'starter', team: 'acme', usage: {} },
      loading: false,
      error: false,
      isSuccess: true,
    });
    render(<BillingPage />);
    const upgradeBtn = screen.getByRole('button', { name: /upgrade to pro/i });
    expect(upgradeBtn).toBeInTheDocument();
    expect(upgradeBtn.tagName).toBe('BUTTON');
    // Focusable + keyboard activation contract (Enter AND Space both fire
    // `click` natively on <button>; jsdom doesn't dispatch synthesized key
    // → click bridging, so we lock the structural invariant instead).
    expect(upgradeBtn.getAttribute('type')).toBe('button');
    expect(upgradeBtn.className).toMatch(/focus-visible:ring/);
  });

  // theo-cloud#63 (BLOCKER functional_bug): POST /v1/billing/checkout {plan:'pro'}
  // returns 503 + actionable body `{"code":"BILLING_NOT_CONFIGURED","message":
  // "Plan 'pro' is not available for purchase yet. Please contact support."}` per
  // release-blockers-2026-06-25-set T4.2 backend fix. Pre-fix the UI catch block
  // showed the generic toast "Failed to start checkout. Please try again." which
  // (a) discarded the server's actionable message and (b) suggested retry for a
  // non-transitory condition (every retry → 503 again, user stuck). Fix opts the
  // billing checkout mutation into cloudFetch `{ throwOnError: true }` so the
  // ApiError surfaces with the server's body, and the catch block reads
  // `error.body.message` for actionable copy (KISS: no new UI invented).
  it('test_billing_upgrade_surfaces_server_actionable_message_when_503_BILLING_NOT_CONFIGURED_closes_63', async () => {
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'starter', team: 'acme', usage: {} },
      loading: false,
      error: false,
      isSuccess: true,
    });
    // Backend canonical 503 shape per Sprint 4 release-blockers fix.
    mockCloudFetch.mockRejectedValue(new ApiError(503, {
      code: 'BILLING_NOT_CONFIGURED',
      message: "Plan 'pro' is not available for purchase yet. Please contact support.",
    }));

    const user = userEvent.setup();
    render(<BillingPage />);
    await user.click(screen.getByRole('button', { name: /upgrade to pro/i }));

    // UI surfaces the SERVER's actionable message.
    const alert = await screen.findByRole('alert');
    const text = alert.textContent ?? '';
    expect(text).toMatch(/Plan 'pro' is not available for purchase yet/);
    expect(text).toMatch(/contact support/i);

    // Anti-regression: the misleading "Please try again" copy MUST NOT appear
    // for a non-transitory 503 (Sprint 4 #39 distinguished the 4xx user-input
    // class from the 5xx operator-action class; #63 closes the UI parity).
    expect(text).not.toMatch(/please try again/i);
  });

  // Red Team theo-cloud#72 closure: a double-tap on the Upgrade button
  // used to fire two POST /v1/billing/checkout requests in a row. The
  // disabled={actionLoading} guard ensures the first click locks the
  // button until the promise resolves.
  it('upgrade button is disabled while the checkout request is in flight (#72)', async () => {
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'free', team: 'acme', usage: {}, period_end: '2026-12-31' },
      loading: false,
      error: false,
      isSuccess: true,
    });
    // Resolve only after we observe the button getting disabled. A never-
    // resolving promise would leave the test hanging on the timeout.
    let releaseFetch!: (v: { url: string }) => void;
    mockCloudFetch.mockReturnValue(
      new Promise<{ url: string }>((resolve) => {
        releaseFetch = resolve;
      }),
    );

    const user = userEvent.setup();
    render(<BillingPage />);
    const button = screen.getByRole('button', { name: /upgrade to pro/i });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(button).toBeDisabled();
    // Cleanup so the test exits cleanly.
    releaseFetch({ url: 'https://checkout.stripe.com/x' });
  });

  // Red Team theo-cloud#72 re-open: React 18 batches setActionLoading until
  // the click handler returns, so disabled={actionLoading} alone does NOT
  // block a SYNCHRONOUS double-click. Two clicks fired before the next
  // render both see disabled=false and both POST. A ref guard short-circuits
  // the 2nd click synchronously; this test fires both clicks before the
  // promise resolves and asserts cloudFetch was called exactly once.
  it('synchronous double-click on Upgrade fires the request only once (#72 re-open)', async () => {
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'free', team: 'acme', usage: {}, period_end: '2026-12-31' },
      loading: false,
      error: false,
      isSuccess: true,
    });
    let releaseFetch!: (v: { url: string }) => void;
    mockCloudFetch.mockReturnValue(
      new Promise<{ url: string }>((resolve) => {
        releaseFetch = resolve;
      }),
    );
    render(<BillingPage />);
    const button = screen.getByRole('button', { name: /upgrade to pro/i }) as HTMLButtonElement;
    // Two synchronous clicks before React can re-render — the ref guard
    // is the only thing that can prevent both from firing.
    button.click();
    button.click();
    expect(mockCloudFetch).toHaveBeenCalledTimes(1);
    releaseFetch({ url: 'https://checkout.stripe.com/x' });
  });

  // Red Team theo-cloud#40 closure: when the backend returns a 4xx with
  // no actionable body, the prior copy was "Please try again." — which
  // misleads the user into hammering a permanently non-retryable
  // endpoint. The new copy points to support.
  // Red Team theo-cloud#49/#69 closure: a Free-tier visitor clicking
  // Manage Plan used to see no feedback — the cloudFetch silent-null
  // path swallowed the 4xx. Opt-in to throwOnError + surface the
  // canonical "contact support" message so the button is no longer a
  // dead-end.
  it('Manage Plan surfaces a contact-support alert on 4xx (#49/#69)', async () => {
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'pro', team: 'acme', usage: {}, period_end: '2026-12-31' },
      loading: false,
      error: false,
      isSuccess: true,
    });
    mockCloudFetch.mockRejectedValueOnce(new ApiError(400, {}));
    const user = userEvent.setup();
    render(<BillingPage />);
    const button = screen.getByRole('button', { name: /manage plan/i });
    await user.click(button);
    const alert = await screen.findByRole('alert');
    const text = alert.textContent ?? '';
    expect(text.toLowerCase()).toContain('contact support');
  });

  it('4xx without body surfaces "contact support" copy, NOT "try again" (#40)', async () => {
    mockUseCloudApi.mockReturnValue({
      data: { plan: 'free', team: 'acme', usage: {}, period_end: '2026-12-31' },
      loading: false,
      error: false,
      isSuccess: true,
    });
    mockCloudFetch.mockRejectedValueOnce(new ApiError(400, {}));
    const user = userEvent.setup();
    render(<BillingPage />);
    const button = screen.getByRole('button', { name: /upgrade to pro/i });
    await user.click(button);
    const alert = await screen.findByRole('alert');
    const text = alert.textContent ?? '';
    expect(text.toLowerCase()).toContain('contact support');
    expect(text.toLowerCase()).not.toContain('please try again');
  });

  it('test_billing_memory_metrics_query_disabled_on_non_memory_route_closes_21', () => {
    // Sprint 3 Phase 3 (#21) v1.1 ADR D2 — MemoryUsageCard on /billing must
    // pass `{ enabled: false }` to useCloudApi for `/v1/dashboard/memory/metrics`
    // (because pathname.startsWith('/memory') is false on /billing). This
    // prevents the noisy 404 console spam reported by QA against dev-public.
    mockUseCloudApi.mockReturnValue({ data: null, loading: false, error: false, isSuccess: true });
    render(<BillingPage />);
    // The MemoryUsageCard call site MUST appear in the mock log with enabled=false.
    const memoryCalls = mockUseCloudApi.mock.calls.filter(
      (args) => args[0] === '/v1/dashboard/memory/metrics',
    );
    expect(memoryCalls.length).toBeGreaterThan(0);
    // Every memory-metrics call from /billing route must have enabled=false.
    for (const call of memoryCalls) {
      expect(call[1]?.enabled).toBe(false);
    }
  });
});

describe('B-136 — a tela não afirma preço que não consegue verificar', () => {
  // A tela dizia "Upgrade to Pro — $29/mo" e "10 projects, 3 environments, 1000 builds/month"
  // como literais. Nem a API nem o servidor conhecem esses números: `/v1/billing` descreve só o
  // plano ATUAL, e `internal/billing/plans.go` guarda apenas os Price IDs do Stripe — o valor vive
  // no Stripe. Mudar o preço lá deixava a tela cobrando $29 na frase e outro valor no cartão.
  //
  // Este guarda é de FONTE, e não de renderização, de propósito: o defeito é alguém digitar um
  // preço no arquivo, e um teste de tela só o pegaria no ramo de plano que aquele teste montou.
  const semComentarios = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const fontes = [
    'src/pages/settings/billing.tsx',
    'src/pages/settings/upgrade-offers.ts',
  ];

  it.each(fontes)('%s não traz nenhum valor monetário literal', (rel) => {
    const src = readFileSync(resolve(__dirname, '../../..', rel), 'utf-8');
    const literais = semComentarios(src).match(/\$\s?\d[\d.,]*/g) ?? [];
    expect(
      literais,
      `preço fixo no código: ${literais.join(', ')}. O valor autoritativo está no Stripe e ` +
        `aparece no checkout; quando existir um endpoint de catálogo, use formatPlanPrice.`,
    ).toEqual([]);
  });

  it('as cotas numéricas do plano-alvo também saíram', () => {
    // Sem comentários, pela mesma razão do guarda acima: o docblock CITA o texto antigo para
    // explicar por que ele saiu, e citar não é afirmar.
    const src = semComentarios(
      readFileSync(resolve(__dirname, '../../..', 'src/pages/settings/upgrade-offers.ts'), 'utf-8'),
    );
    // `plan_cap` da API descreve o plano ATUAL; a cota do plano-alvo não vem de lugar nenhum, e
    // "1000 builds/month" era tão inverificável quanto o preço.
    expect(src).not.toMatch(/\d+\s*(projects|environments|builds)/i);
  });
});
