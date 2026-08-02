import { registerRoute } from './server';

/**
 * M25 — o BFF de prompts, para que a jornada do catálogo seja exercitável sem backend.
 *
 * O estado é in-memory e MUTÁVEL de propósito: a jornada que o milestone precisa provar é
 * catálogo → detalhe → promover → o label passa a apontar para outra revisão. Um mock que
 * devolvesse sempre os mesmos labels deixaria passar exatamente o defeito que importa — a tela
 * não refletir o que o operador acabou de fazer.
 */
const promptlyDb: {
  catalog: { name: string; latestVersion: number; labels: { label: string; version: number }[]; updatedAt: string }[];
  revisions: Record<string, { version: number; content: string; createdAt: string }[]>;
  policies: Record<string, { datasetId: string; minScore: number }>;
} = {
  catalog: [
    {
      name: 'saudacao',
      latestVersion: 3,
      // DOIS labels de propósito: `prod` sem política (promoção livre) e `staging` com uma que
      // recusa. Sem o par, a jornada provaria só o caminho feliz — e a mensagem tipada da recusa
      // poderia estar sendo colapsada em "erro" sem nada acusar.
      labels: [
        { label: 'prod', version: 1 },
        { label: 'staging', version: 2 },
      ],
      updatedAt: '2026-08-01T10:00:00Z',
    },
    { name: 'despedida', latestVersion: 1, labels: [], updatedAt: '2026-07-30T09:00:00Z' },
    // 30 revisões: o único cenário em que o defeito #364 é observável. Com 3 revisões a página
    // contém tudo e a janela errada passa despercebida — foi assim que ele escapou.
    {
      name: 'longo',
      latestVersion: 30,
      labels: [{ label: 'prod', version: 12 }],
      updatedAt: '2026-08-02T10:00:00Z',
    },
  ],
  revisions: {
    saudacao: [
      { version: 1, content: 'Olá, {{nome}}. Como posso ajudar?', createdAt: '2026-07-28T10:00:00Z' },
      { version: 2, content: 'Oi, {{nome}}! Em que posso ajudar hoje?', createdAt: '2026-07-30T10:00:00Z' },
      { version: 3, content: 'Olá {{nome}}, sou o assistente. Como ajudo?', createdAt: '2026-08-01T10:00:00Z' },
    ],
    despedida: [{ version: 1, content: 'Até logo, {{nome}}.', createdAt: '2026-07-30T09:00:00Z' }],
    longo: Array.from({ length: 30 }, (_, i) => ({
      version: i + 1,
      content: `revisao numero ${i + 1}`,
      createdAt: '2026-08-02T10:00:00Z',
    })),
  },
  // `saudacao/prod` NÃO tem política: a promoção é livre, e a tela precisa dizer isso com todas as
  // letras. `saudacao/staging` tem — e é o lado que prova que a recusa do serviço chega inteira.
  // Sem os dois lados, o e2e provaria metade.
  policies: {
    'saudacao::staging': { datasetId: 'ds-saudacoes', minScore: 0.8 },
  },
};

/**
 * O prefixo depende de `window.__THEO_CONFIG__.API_URL`, vazio em dev (same-origin) e `/api`
 * atrás do gateway. Registrar os dois evita que o mock funcione numa configuração e
 * silenciosamente não na outra — o modo de falha que já custou a primeira execução do e2e de trust.
 */
export function registerPromptlyHandlers() {
  for (const prefix of ['', '/api']) registerPromptlyRoutes(`${prefix}/v1/dashboard/promptly`);
}

function registerPromptlyRoutes(base: string) {
  // O índice: uma linha por nome, SEM `content` — o mesmo contrato do serviço. Devolver o corpo
  // aqui faria o mock ser mais permissivo que a produção, e o e2e passaria numa tela que quebra.
  registerRoute('GET', `${base}/prompts`, async () => Response.json(promptlyDb.catalog));

  // O prompt resolvido — a tela o usa para saber qual é a ÚLTIMA revisão antes de pedir a janela.
  registerRoute('GET', `${base}/prompts/{name}`, async (_req, { name }) => {
    const revs = promptlyDb.revisions[decodeURIComponent(name)];
    if (!revs || revs.length === 0) {
      return Response.json({ error: 'prompt_not_found', name }, { status: 404 });
    }
    return Response.json(revs[revs.length - 1]);
  });

  registerRoute('GET', `${base}/prompts/{name}/revisions`, async (req, { name }) => {
    const revs = promptlyDb.revisions[decodeURIComponent(name)] ?? [];
    const params = new URL(req.url).searchParams;
    // O limite é honrado: se a tela deixar de pedir, o mock devolve tudo e o teste que protege o
    // teto deixa de discriminar.
    const limit = Number(params.get('limit') ?? '10');
    // E o cursor TAMBÉM: a rota real ordena da revisão mais ANTIGA para a mais nova e corta com
    // `limit`, então sem `after` ela devolve o COMEÇO do histórico (#364). Um mock que ignorasse
    // `after` devolveria sempre as revisões certas por acaso, e o e2e passaria numa tela que no
    // ar mostra as 10 mais velhas rotuladas como as mais novas.
    const after = Number(params.get('after') ?? '0');
    const janela = revs.filter((r) => r.version > after);
    return Response.json(janela.slice(0, Math.max(1, limit)));
  });

  registerRoute('GET', `${base}/prompts/{name}/labels`, async (_req, { name }) => {
    const entrada = promptlyDb.catalog.find((c) => c.name === decodeURIComponent(name));
    return Response.json(entrada?.labels ?? []);
  });

  registerRoute('GET', `${base}/prompts/{name}/policies/{label}`, async (_req, { name, label }) => {
    const chave = `${decodeURIComponent(name)}::${decodeURIComponent(label)}`;
    const p = promptlyDb.policies[chave];
    // 404 TIPADO: "nenhuma regra governa este label" é um fato, e a tela renderiza *promoção
    // livre*. Um 200 com corpo vazio faria a tela não conseguir distinguir isso de uma falha.
    if (!p) {
      return Response.json(
        { error: 'policy_not_found', name: decodeURIComponent(name), label: decodeURIComponent(label) },
        { status: 404 },
      );
    }
    return Response.json({ name: decodeURIComponent(name), label: decodeURIComponent(label), ...p });
  });

  registerRoute('PUT', `${base}/prompts/{name}/labels/{label}`, async (req, { name, label }) => {
    const nome = decodeURIComponent(name);
    const lbl = decodeURIComponent(label);
    const body = (await req.json()) as { version?: number };
    const version = body.version ?? 0;

    const politica = promptlyDb.policies[`${nome}::${lbl}`];
    if (politica) {
      // A recusa carrega os NÚMEROS — é o que diz ao operador por que a promoção foi barrada.
      // Sem eles ele vê "erro" e tenta de novo igual.
      return Response.json(
        {
          error: 'promotion_blocked',
          message: `a promoção exige score ≥ ${politica.minScore} no dataset ${politica.datasetId}; a melhor execução desta revisão obteve 0.41`,
          required: politica.minScore,
          actual: 0.41,
        },
        { status: 409 },
      );
    }

    const entrada = promptlyDb.catalog.find((c) => c.name === nome);
    if (!entrada) return Response.json({ error: 'prompt_not_found', name: nome }, { status: 404 });
    const ponteiro = entrada.labels.find((l) => l.label === lbl);
    if (ponteiro) {
      ponteiro.version = version;
    } else {
      entrada.labels.push({ label: lbl, version });
    }
    return Response.json({ name: nome, label: lbl, version });
  });
}
