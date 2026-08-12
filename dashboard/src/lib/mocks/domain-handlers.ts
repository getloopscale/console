import { registerRoute } from './server';
import { domainsFixture } from './fixtures';
import type { Domain, DomainListResponse } from '@/lib/api/types';

/**
 * Handlers de domínios — extraídos de `handlers.ts` (B-107, 2026-08-10).
 *
 * ## Por que saíram de lá
 *
 * `handlers.ts` está na dívida registrada de `max-lines` com teto anotado, e a catraca de
 * `loc-budget-ratchet.test.ts` não tem folga: o número só desce. Acrescentar a alavanca
 * `__THEO_MOCK_NO_DOMAINS` — quatro linhas — a reprovou, o que é exatamente o que ela existe
 * para fazer.
 *
 * A alternativa era encurtar o comentário até caber, trocando a explicação por duas linhas
 * de orçamento. Isso é a falsa economia que a catraca não deveria causar. O contrato dela diz
 * a saída certa em voz alta: *"decompor um arquivo baixa o número e o teste segue verde"*.
 *
 * A forma segue os irmãos que já existiam — `trust-handlers.ts`, `lens-handlers.ts`,
 * `skills-handlers.ts`, `promptly-handlers.ts`: módulo autocontido, com o seu próprio estado
 * e o seu próprio reset. `db.domains` era usado só aqui e no `resetMockDB`, então a extração
 * não corta nada ao meio.
 */
const estado: { domains: Domain[] } = { domains: [...domainsFixture] as Domain[] };

/** Repõe as fixtures. Chamado por `resetMockDB()`. */
export function resetDomainMocks(): void {
  estado.domains = [...domainsFixture] as Domain[];
}

function err(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function registerDomainHandlers() {
  registerRoute('GET', '/api/v1/domains', async () => {
    // `__THEO_MOCK_NO_DOMAINS` (B-107) — alavanca de estado, quarta do idioma de
    // `__THEO_MOCK_LOGGED_OUT`. Motivo em `e2e/a11y.spec.ts` § `#81`.
    const ds = (window as unknown as { __THEO_MOCK_NO_DOMAINS?: boolean }).__THEO_MOCK_NO_DOMAINS ? [] : estado.domains;
    return Response.json({ domains: ds, total: ds.length } satisfies DomainListResponse);
  });

  registerRoute('GET', '/api/v1/domains/{domain}', async (_req, { domain }) => {
    const d = estado.domains.find((x) => x.domain === domain);
    if (!d) return err('NOT_FOUND', `Domain "${domain}" not found`, 404);
    return Response.json(d);
  });

  registerRoute('POST', '/api/v1/domains', async (req) => {
    const body = (await req.json()) as {
      domain?: string;
      project?: string;
      app?: string;
      environment?: string;
    };
    if (!body.domain) return err('INVALID_INPUT', 'domain required', 400);
    if (estado.domains.find((d) => d.domain === body.domain)) {
      return err('CONFLICT', `Domain "${body.domain}" already exists`, 409);
    }
    const domain: Domain = {
      id: `dom-${Date.now()}`,
      domain: body.domain,
      project: body.project ?? '',
      app: body.app ?? '',
      environment: body.environment ?? 'production',
      status: 'pending_verification',
      cname_target: `${body.project ?? 'app'}.theo.app`,
      created_at: new Date().toISOString(),
      verification: {
        txt_name: `_theo.${body.domain}`,
        txt_value: `verify=${Math.random().toString(36).slice(2, 18)}`,
      },
    };
    estado.domains.push(domain);
    return Response.json(domain, { status: 201 });
  });

  registerRoute('POST', '/api/v1/domains/{domain}/verify', async (_req, { domain }) => {
    const d = estado.domains.find((x) => x.domain === domain);
    if (!d) return err('NOT_FOUND', `Domain "${domain}" not found`, 404);
    d.status = 'verified';
    d.verified_at = new Date().toISOString();
    delete d.verification;
    return Response.json(d);
  });

  registerRoute('DELETE', '/api/v1/domains/{domain}', async (_req, { domain }) => {
    const i = estado.domains.findIndex((x) => x.domain === domain);
    if (i < 0) return err('NOT_FOUND', `Domain "${domain}" not found`, 404);
    estado.domains.splice(i, 1);
    return new Response(null, { status: 204 });
  });
}
