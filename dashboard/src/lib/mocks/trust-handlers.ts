import { registerRoute } from './server';

/**
 * M24 — o BFF de trust, para que a jornada de guardrails seja exercitável sem backend.
 *
 * O estado é in-memory e MUTÁVEL de propósito: a jornada que o milestone precisa provar é
 * criar → aparecer no catálogo → remover → sumir. Um mock que devolvesse sempre a mesma lista
 * deixaria passar exatamente o defeito que importa — a tela não refletir o que o operador fez.
 */
const trustDb: {
  platform: { source: 'platform'; name: string; category: string | null; kind: string; directions: string[] }[];
  tenant: { source: 'tenant'; id: string; name: string; kind: string; directions: string[] }[];
  violations: Record<string, unknown>[];
  events: Record<string, unknown>[];
} = {
  /**
   * B-127 — `category` is what `coverageGap` matches an observed policy against
   * (`pages/trust/components/trust-series.ts:162-172`), and it is REQUIRED (nullable) on the
   * canonical entry (`loopguardrails/packages/guardrails-client/src/types.ts:10`).
   *
   * It was missing here. Measured in the browser on 2026-08-11, `/trust` read
   * `3 policies / 0 blocked` over a catalogue that covers one of them: with nothing to match on,
   * the "blocked" column was structurally blind and every policy read as uncovered. A blind column
   * that always answers "uncovered" is indistinguishable from a real coverage gap — the reading
   * looked alarming and meant nothing.
   */
  platform: [
    { source: 'platform', name: 'credential-mask', category: 'credential_leak', kind: 'credential-mask', directions: ['input', 'output'] },
    { source: 'platform', name: 'pii', category: 'pii', kind: 'pii', directions: ['input', 'output'] },
    { source: 'platform', name: 'jailbreak', category: 'jailbreak', kind: 'jailbreak', directions: ['input', 'tool_input'] },
  ],
  tenant: [],
  /**
   * B-127 — the observation plane's reading, which `/trust` and `/violations` both read.
   *
   * Three policies, two of them WITHOUT a guardrail in `platform` above (`profanity` and
   * `prompt-leak` are not in the catalogue). That asymmetry is the point: with every observed
   * policy enforced, the coverage KPIs would read `3 policies / 3 blocked` and a bug that ignores
   * the enforced flag would look identical to correct behaviour. The seed makes the verdict above
   * the numbers have something to say.
   *
   * `redacted` carries the already-masked excerpt the service sends — never raw content.
   *
   * `credential_leak` IS in the catalogue above and the other two are not, so the coverage reading
   * is asymmetric. Symmetry would be the problem: `3 of 3 uncovered` looks the same whether the
   * matching works or is broken, which is precisely how the blind column survived unnoticed.
   */
  violations: [
    {
      id: 'pv-1',
      conversationId: 'conv-1',
      policy: 'credential_leak',
      severity: 'high',
      redacted: 'sk_live_***',
      detectedAt: '2026-08-09T14:22:00Z',
    },
    {
      id: 'pv-2',
      conversationId: 'conv-1',
      policy: 'profanity',
      severity: 'low',
      redacted: '***',
      detectedAt: '2026-08-10T09:05:00Z',
    },
    {
      id: 'pv-3',
      conversationId: 'conv-2',
      policy: 'prompt-leak',
      severity: 'medium',
      redacted: 'system prompt ***',
      detectedAt: '2026-08-10T18:40:00Z',
    },
  ],
  events: [
    {
      id: 'evt-seed',
      decision: 'block',
      direction: 'input',
      category: 'credential_leak',
      validatorName: 'credential-mask',
      redacted: 'sk_live_***',
      createdAt: '2026-07-31T12:00:00Z',
    },
  ],
};

/**
 * O prefixo depende de `window.__LOOPSCALE_CONFIG__.API_URL`, que é vazio em dev (same-origin) e
 * `/api` quando servido atrás do gateway. Registrar os dois evita que o mock funcione numa
 * configuração e silenciosamente não na outra — o modo de falha que custou a primeira execução
 * deste e2e, em que a tela corretamente mostrou "não foi possível carregar" e o teste acusou.
 */
export function registerTrustHandlers() {
  for (const prefix of ['', '/api']) registerTrustRoutes(`${prefix}/v1/dashboard/trust`);
}

function registerTrustRoutes(base: string) {
  registerRoute('GET', `${base}/validators`, async () =>
    Response.json({ catalogVersion: 1, validators: [...trustDb.platform, ...trustDb.tenant] }),
  );

  registerRoute('GET', `${base}/enforcement-events`, async () =>
    Response.json({ events: trustDb.events }),
  );

  /**
   * B-127 — measured missing on 2026-08-11: `/trust` and `/violations` both read this path and the
   * mock served nothing, so both screens rendered as a read failure in mock mode. The screens were
   * behaving correctly; a missing route was reading as a broken product.
   *
   * `limit` is honoured rather than ignored. The screens ask for different limits by design
   * (`overview` 200, `violations` 100), and a mock that returns everything regardless would hide a
   * truncation bug behind a seed too small to truncate.
   */
  registerRoute('GET', `${base}/policy-violations`, async (req) => {
    const limit = Number(new URL(req.url).searchParams.get('limit') ?? '100');
    const capped = Number.isFinite(limit) && limit > 0 ? limit : 100;
    // `has_more` is REQUIRED by `loopguardrails/openapi.yaml:365` — the B-114/B-120 discipline, because
    // a list that truncates in silence is read as complete. A mock that omits it lets a screen be
    // developed against a shape the service does not send.
    return Response.json({
      violations: trustDb.violations.slice(0, capped),
      has_more: trustDb.violations.length > capped,
    });
  });

  /** The drill-down from a violation row. Without it the row leads to a dead screen in mock mode. */
  registerRoute('GET', `${base}/conversations/{id}`, async (_req, { id }) =>
    Response.json({
      id,
      messages: [
        { id: 'm-1', role: 'user', content: 'here is my key: sk_live_***', createdAt: '2026-08-09T14:21:58Z' },
        { id: 'm-2', role: 'assistant', content: 'I cannot use that key.', createdAt: '2026-08-09T14:22:01Z' },
      ],
    }),
  );

  // Dry-run: NÃO grava nada — é o que o teste da tela precisa poder confiar.
  registerRoute('POST', `${base}/guardrails/test`, async (req) => {
    const body = (await req.json()) as { spec?: { terms?: string[] }; content?: string };
    const terms = body.spec?.terms ?? [];
    const hit = terms.some((t) => (body.content ?? '').toLowerCase().includes(t.toLowerCase()));
    return Response.json({ valid: true, result: { action: hit ? 'block' : 'allow' } });
  });

  registerRoute('POST', `${base}/guardrails/`, async (req) => {
    const body = (await req.json()) as { name?: string; spec?: { kind?: string } };
    const name = body.name ?? '';
    if (trustDb.platform.some((p) => p.name === name)) {
      return Response.json(
        { code: 'VALIDATOR_NAME_RESERVED', message: `name "${name}" is reserved by the platform` },
        { status: 422 },
      );
    }
    if (trustDb.tenant.some((t) => t.name === name)) {
      return Response.json(
        { code: 'CONFLICT', message: 'a validator with this name already exists' },
        { status: 409 },
      );
    }
    const created = {
      source: 'tenant' as const,
      id: `val-${trustDb.tenant.length + 1}`,
      name,
      kind: body.spec?.kind ?? 'ban-list',
      directions: ['input'],
    };
    trustDb.tenant.push(created);
    return Response.json(created, { status: 201 });
  });

  registerRoute('DELETE', `${base}/guardrails/{id}`, async (_req, { id }) => {
    const before = trustDb.tenant.length;
    trustDb.tenant = trustDb.tenant.filter((t) => t.id !== id);
    return trustDb.tenant.length === before
      ? Response.json({ code: 'NOT_FOUND', message: 'validator not found' }, { status: 404 })
      : new Response(null, { status: 204 });
  });
}
