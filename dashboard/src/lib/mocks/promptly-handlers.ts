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

/**
 * As variáveis declaradas por um conteúdo — mesma regra do serviço: os tokens `{{identificador}}`,
 * na ordem de primeira aparição, sem repetição. A presença É a declaração.
 */
function variaveisDe(content: string): string[] {
  const vistas = new Set<string>();
  for (const m of content.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) {
    const nome = m[1];
    if (nome !== undefined) vistas.add(nome);
  }
  return [...vistas];
}

function registerPromptlyRoutes(base: string) {
  // O índice: uma linha por nome, SEM `content` — o mesmo contrato do serviço. Devolver o corpo
  // aqui faria o mock ser mais permissivo que a produção, e o e2e passaria numa tela que quebra.
  /**
   * M13 — o catálogo honra `?limit` e SINALIZA continuação como o serviço real.
   *
   * O mock devolvia a lista inteira e nenhum header. Sob ele, o painel jamais renderizaria a marca
   * de parcialidade — e um e2e verde afirmaria uma jornada que o produto real não cumpre. O
   * cenário de continuação existe aqui para que o caminho seja EXERCITÁVEL, não presumido.
   *
   * O `Link` aponta para a rota do BFF (`/v1/dashboard/promptly/prompts`), não para a do serviço:
   * é o que o handler real faz desde o EC-1, e um mock que publicasse o caminho do serviço
   * validaria a versão errada do contrato.
   */
  registerRoute('GET', `${base}/prompts`, async (req) => {
    const url = new URL(req.url, 'http://localhost');
    const bruto = url.searchParams.get('limit');
    const limit = bruto !== null && Number.isInteger(Number(bruto)) && Number(bruto) > 0 ? Number(bruto) : 100;

    const pagina = promptlyDb.catalog.slice(0, limit);
    const temMais = promptlyDb.catalog.length > limit;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (temMais && pagina.length > 0) {
      const cursor = encodeURIComponent(pagina[pagina.length - 1]!.name);
      headers.Link = `<${base}/prompts?after=${cursor}&limit=${String(limit)}>; rel="next"`;
    }
    return new Response(JSON.stringify(pagina), { status: 200, headers });
  });

  /**
   * O prompt resolvido — a tela o usa para saber qual é a ÚLTIMA revisão antes de pedir a janela,
   * e o playground do M14 o usa para saber QUAIS CAMPOS mostrar.
   *
   * `variables` é derivado aqui pela mesma regra do serviço (`to-prompt-wire.ts`: os tokens
   * `{{...}}` do conteúdo, na ordem, sem repetição) porque o mock não o devolvia — e um mock menos
   * fiel que a produção faz o e2e passar sobre uma tela que renderizaria ZERO campos. É o modo de
   * falha que o cabeçalho deste arquivo já alertava para o `content` do catálogo.
   */
  registerRoute('GET', `${base}/prompts/{name}`, async (_req, { name }) => {
    const revs = promptlyDb.revisions[decodeURIComponent(name)];
    if (!revs || revs.length === 0) {
      return Response.json({ error: 'prompt_not_found', name }, { status: 404 });
    }
    const ultima = revs[revs.length - 1]!;
    return Response.json({ ...ultima, name: decodeURIComponent(name), variables: variaveisDe(ultima.content) });
  });

  /**
   * M14 — o playground. Devolve uma saída determinística que ECOA o conteúdo renderizado, para o
   * e2e poder distinguir "rodou o que estava na tela" de "rodou outra coisa".
   *
   * Recusa a variável vazia com o MESMO código do serviço (`400 missing_variable`): um mock que
   * sempre aceitasse deixaria a jornada verde sobre a guarda pré-gasto quebrada.
   */
  registerRoute('POST', `${base}/prompts/{name}/playground`, async (req) => {
    const corpo = (await req.json()) as {
      credential?: string;
      content?: string;
      variables?: Record<string, string>;
    };
    const content = corpo.content ?? '';
    const variables = corpo.variables ?? {};

    const faltante = variaveisDe(content).find((v) => (variables[v] ?? '').trim() === '');
    if (faltante !== undefined) {
      return Response.json({ error: 'missing_variable', variable: faltante }, { status: 400 });
    }
    if ((corpo.credential ?? '').trim() === '') {
      return Response.json({ error: 'invalid_body' }, { status: 400 });
    }

    const renderizado = content.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_m, n: string) => variables[n] ?? '');
    return Response.json({ text: `[modelo simulado] ${renderizado}`, latencyMs: 42 });
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

  // ── M12: as duas ESCRITAS da jornada. Sem elas a tela de autoria e a de reversão não entram
  // no e2e hermético, e o milestone provaria só a metade que lê.
  registerRoute('POST', `${base}/prompts`, async (req) => {
    const body = (await req.json()) as { name?: string; content?: string };
    const nome = String(body.name ?? '');
    const conteudo = String(body.content ?? '');
    const lista = (promptlyDb.revisions[nome] ??= []);
    const version = lista.length + 1;
    lista.push({ version, content: conteudo, createdAt: '2026-08-03T12:00:00Z' });
    const entrada = promptlyDb.catalog.find((c) => c.name === nome);
    if (entrada) entrada.latestVersion = version;
    else promptlyDb.catalog.push({ name: nome, latestVersion: version, labels: [], updatedAt: '2026-08-03T12:00:00Z' });
    return Response.json({ id: `rev-${version}`, name: nome, content: conteudo, version, createdAt: '2026-08-03T12:00:00Z', variables: [] }, { status: 201 });
  });

  registerRoute('POST', `${base}/prompts/{name}/rollback`, async (req, { name }) => {
    const nome = decodeURIComponent(name);
    const body = (await req.json()) as { toVersion?: number; label?: string };
    const entrada = promptlyDb.catalog.find((c) => c.name === nome);
    const lista = promptlyDb.revisions[nome] ?? [];
    const origem = lista.find((r) => r.version === body.toVersion);
    if (!entrada || !origem) {
      return Response.json({ error: 'prompt_not_found', name: nome, toVersion: body.toVersion }, { status: 404 });
    }
    // A ambiguidade é REAL na API e a jornada precisa dela: um prompt COM labels e sem label
    // nomeado recusa com 400 e a lista — é o que transforma a recusa em escolha na tela.
    if (!body.label && entrada.labels.length > 0) {
      return Response.json(
        {
          error: 'label_required',
          message: `rollback de "${nome}" precisa do label a reverter — existentes: ${entrada.labels.map((l) => l.label).join(', ')}`,
          availableLabels: entrada.labels.map((l) => l.label),
        },
        { status: 400 },
      );
    }
    const version = lista.length + 1;
    lista.push({ version, content: origem.content, createdAt: '2026-08-03T12:05:00Z' });
    entrada.latestVersion = version;
    const movidos: string[] = [];
    if (body.label) {
      const ponteiro = entrada.labels.find((l) => l.label === body.label);
      if (ponteiro) { ponteiro.version = version; movidos.push(body.label); }
    }
    // labelsMoved PODE voltar vazio, e é justamente o caso que a tela não pode ler como sucesso.
    return Response.json(
      { id: `rev-${version}`, name: nome, content: origem.content, version, createdAt: '2026-08-03T12:05:00Z', variables: [], labelsMoved: movidos, currentLabels: entrada.labels },
      { status: 201 },
    );
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
