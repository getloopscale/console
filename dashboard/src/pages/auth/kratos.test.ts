import { describe, it, expect , vi } from 'vitest';
import { enrichKratosError, flowUrl, submitFlow, FlowSubmitError, initFlow } from './kratos';

describe('enrichKratosError (T0.1 EC-02)', () => {
  it('test_enrichKratosError_passes_through_specific_messages', () => {
    // Specific messages already actionable — don't append extra action
    const out = enrichKratosError('Invalid email address.', 'login');
    expect(out).toBe('Invalid email address.');
  });

  it('test_enrichKratosError_enriches_generic_unexpected_error', () => {
    const out = enrichKratosError('An unexpected error occurred', 'recovery');
    expect(out).toContain('An unexpected error occurred');
    expect(out.toLowerCase()).toContain('check your email');
  });

  it('test_enrichKratosError_enriches_internal_server_error', () => {
    const out = enrichKratosError('Internal server error', 'verification');
    expect(out.toLowerCase()).toContain('request a new verification link');
  });

  it('test_enrichKratosError_is_case_insensitive', () => {
    const out = enrichKratosError('AN UNEXPECTED ERROR OCCURRED', 'login');
    expect(out.toLowerCase()).toContain('check your credentials');
  });

  it('test_enrichKratosError_handles_empty_string', () => {
    const out = enrichKratosError('', 'login');
    // Empty isn't matched as generic; pass-through
    expect(out).toBe('');
  });

  // Red Team loop-console#75 closure: the raw Kratos duplicate-account
  // message references phone/username fields the /register form
  // never collects. Override with copy scoped to the actual fields
  // (email) plus an inline retry path.
  it('rewrites duplicate-account error to email-only copy with CTA hints (#75)', () => {
    const raw =
      'An account with the same identifier (email, phone, username, ...) exists already.';
    const out = enrichKratosError(raw, 'registration');
    // Phone + username MUST NOT appear in user-facing copy for the
    // /register flow.
    expect(out.toLowerCase()).not.toContain('phone');
    expect(out.toLowerCase()).not.toContain('username');
    expect(out.toLowerCase()).toContain('this email already exists');
    // Inline next-step CTAs.
    expect(out.toLowerCase()).toContain('sign in');
    expect(out.toLowerCase()).toContain('reset');
  });
});

describe('B-213 — o id de fluxo vem da URL e atravessa uma URL', () => {
  it('codifica o id em vez de interpolá-lo cru', () => {
    // O id vem de `searchParams.get('flow')` — uma entrada controlada por quem monta o link. Cru,
    // um `&` ou um `#` nele deixa de ser dado e vira estrutura: `?id=a&redirect_to=…` acrescenta
    // um parâmetro que ninguém escreveu, e o Kratos o lê como se fosse nosso.
    expect(flowUrl('https://auth.example', 'login', 'a&b')).toBe(
      'https://auth.example/self-service/login/flows?id=a%26b',
    );
  });

  it('codifica um # que encerraria a query', () => {
    expect(flowUrl('https://auth.example', 'verification', 'x#y')).toBe(
      'https://auth.example/self-service/verification/flows?id=x%23y',
    );
  });

  it('um id comum atravessa intacto', () => {
    // A codificação não pode custar legibilidade no caminho normal: um UUID não muda.
    const uuid = '0e3f7a2c-2b1d-4a55-9f0e-7c1c2f9d6b31';
    expect(flowUrl('https://auth.example', 'registration', uuid)).toBe(
      `https://auth.example/self-service/registration/flows?id=${uuid}`,
    );
  });
});

describe('B-232 — submitFlow distingue uma recusa do serviço de uma recusa de validação', () => {
  it('um 5xx vira erro tipado em vez de ser devolvido como se fosse um Flow', async () => {
    // O status era descartado: `return resp.json()`. Um 500 devolvendo `{"error":"..."}` saía
    // daqui como um `Flow`, e `getFlowMessages` tolera um `ui` ausente — então a tela não mostrava
    // erro nenhum. Uma queda do serviço de identidade ficava indistinguível de "nada aconteceu".
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'internal' }), { status: 500 }),
    );

    await expect(submitFlow('https://auth.example/x', 'POST', {})).rejects.toThrow(FlowSubmitError);
  });

  it('o erro carrega o status observado', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'gateway' }), { status: 502 }),
    );

    const erro = await submitFlow('https://auth.example/x', 'POST', {}).catch((e: unknown) => e);
    expect((erro as FlowSubmitError).status).toBe(502);
  });

  it('um 400 de VALIDAÇÃO continua devolvendo o Flow — é a resposta normal do Kratos', async () => {
    // O Kratos responde 400 com o fluxo INTEIRO quando um campo é inválido; é assim que a tela
    // mostra "senha muito curta". Transformar isso em exceção quebraria o caminho normal.
    const fluxo = { id: 'f1', ui: { action: '/a', method: 'POST', nodes: [] } };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(fluxo), { status: 400 }),
    );

    await expect(submitFlow('https://auth.example/x', 'POST', {})).resolves.toMatchObject({ id: 'f1' });
  });

  it('um 200 atravessa como sempre', async () => {
    const fluxo = { id: 'ok', ui: { action: '/a', method: 'POST', nodes: [] } };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(fluxo), { status: 200 }));
    await expect(submitFlow('https://auth.example/x', 'POST', {})).resolves.toMatchObject({ id: 'ok' });
  });
});

describe('B-169 — o fluxo de browser segue o 303 em vez de fingir tratá-lo', () => {
  it('devolve o fluxo quando o serviço responde 200', async () => {
    const fluxo = { id: 'f1', ui: { action: '/a', method: 'POST', nodes: [] } };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(fluxo), { status: 200 }));
    await expect(initFlow('login')).resolves.toMatchObject({ id: 'f1' });
  });

  it('pede ao browser para SEGUIR o redirecionamento', async () => {
    // Sob `redirect: 'manual'` o Fetch entrega uma resposta `opaqueredirect`: status 0 e lista de
    // headers vazia. O ramo de 3xx que existia ali era inalcançável por construção — e afirmava,
    // para quem lesse, que o 303 do fluxo de browser estava tratado.
    const espiao = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'f1', ui: { action: '/a', method: 'POST', nodes: [] } }), { status: 200 }),
    );

    await initFlow('login');

    // Procura a chamada ao endpoint de browser: o spy acumula chamadas de casos anteriores, e
    // `calls[0]` seria a de outro teste.
    const chamada = espiao.mock.calls.find((c) => String(c[0]).includes('/self-service/login/browser'));
    expect(chamada?.[1]).toMatchObject({ redirect: 'follow' });
  });

  it('uma recusa do serviço vira erro tipado, e não um Flow vazio', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 502 }));
    await expect(initFlow('login')).rejects.toBeInstanceOf(FlowSubmitError);
  });
});
