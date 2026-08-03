import { registerRoute } from './server';

/**
 * M24 — o BFF de trust, para que a jornada de guardrails seja exercitável sem backend.
 *
 * O estado é in-memory e MUTÁVEL de propósito: a jornada que o milestone precisa provar é
 * criar → aparecer no catálogo → remover → sumir. Um mock que devolvesse sempre a mesma lista
 * deixaria passar exatamente o defeito que importa — a tela não refletir o que o operador fez.
 */
const trustDb: {
  platform: { source: 'platform'; name: string; kind: string; directions: string[] }[];
  tenant: { source: 'tenant'; id: string; name: string; kind: string; directions: string[] }[];
  events: Record<string, unknown>[];
} = {
  platform: [
    { source: 'platform', name: 'credential-mask', kind: 'credential-mask', directions: ['input', 'output'] },
    { source: 'platform', name: 'pii', kind: 'pii', directions: ['input', 'output'] },
    { source: 'platform', name: 'jailbreak', kind: 'jailbreak', directions: ['input', 'tool_input'] },
  ],
  tenant: [],
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
 * O prefixo depende de `window.__THEO_CONFIG__.API_URL`, que é vazio em dev (same-origin) e
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
