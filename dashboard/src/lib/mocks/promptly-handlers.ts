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
  // M16 — `tags` no contrato do mock, como o serviço as devolve. Sem elas o e2e não poderia
  // exercitar nem a coluna nem o filtro por tag.
  catalog: { name: string; latestVersion: number; labels: { label: string; version: number }[]; tags: string[]; updatedAt: string }[];
  revisions: Record<string, { version: number; content: string; createdAt: string }[]>;
  policies: Record<string, { datasetId: string; minScore: number }>;
  // M15 — o uso observado, por prompt e por revisão.
  // M18 — a discussão, por "nome\u001fversão". A chave carrega a VERSÃO porque o comentário é
  // dela: a v8 nasce e o comentário da v7 segue na v7.
  comentarios: Record<string, { id: string; body: string; author: string | null; createdAt: string }[]>;
  uso: Record<string, { revision: number; resolutions: number; totalTokens: number; costUsd: number | null; p50LatencyMs: number | null }[]>;
} = {
  catalog: [
    {
      name: 'saudacao',
      latestVersion: 3,
      tags: ['suporte', 'onboarding'],
      // DOIS labels de propósito: `prod` sem política (promoção livre) e `staging` com uma que
      // recusa. Sem o par, a jornada provaria só o caminho feliz — e a mensagem tipada da recusa
      // poderia estar sendo colapsada em "erro" sem nada acusar.
      labels: [
        { label: 'prod', version: 1 },
        { label: 'staging', version: 2 },
      ],
      updatedAt: '2026-08-01T10:00:00Z',
    },
    { name: 'despedida', latestVersion: 1, labels: [], tags: [], updatedAt: '2026-07-30T09:00:00Z' },
    // M20 — a composição. `atendimento` referencia `policy`, e é o par que torna o DoD-2 e o
    // DoD-4 exercitáveis: sem um prompt que de fato compõe, o alternador de textos nunca aparece e
    // a lista de dependentes é sempre vazia — dois caminhos que passariam por "verdes" sem nunca
    // terem sido percorridos.
    { name: 'policy', latestVersion: 1, labels: [], tags: [], updatedAt: '2026-08-03T09:00:00Z' },
    { name: 'atendimento', latestVersion: 1, labels: [], tags: [], updatedAt: '2026-08-03T10:00:00Z' },
    // 30 revisões: o único cenário em que o defeito #364 é observável. Com 3 revisões a página
    // contém tudo e a janela errada passa despercebida — foi assim que ele escapou.
    {
      name: 'longo',
      latestVersion: 30,
      tags: [],
      labels: [{ label: 'prod', version: 12 }],
      updatedAt: '2026-08-02T10:00:00Z',
    },
  ],
  revisions: {
    saudacao: [
      { version: 1, content: 'Hello, {{name}}. How can I help?', createdAt: '2026-07-28T10:00:00Z' },
      { version: 2, content: 'Hi, {{name}}! What can I help you with today?', createdAt: '2026-07-30T10:00:00Z' },
      { version: 3, content: 'Hello {{name}}, I am the assistant. How can I help?', createdAt: '2026-08-01T10:00:00Z' },
    ],
    despedida: [{ version: 1, content: 'See you, {{name}}.', createdAt: '2026-07-30T09:00:00Z' }],
    policy: [
      { version: 1, content: 'Always be courteous and never promise a deadline.', createdAt: '2026-08-03T09:00:00Z' },
    ],
    atendimento: [
      {
        version: 1,
        content: 'Preamble: @@@promptly:name=policy|version=1@@@\n\nNow answer {{question}}.',
        createdAt: '2026-08-03T10:00:00Z',
      },
    ],
    longo: Array.from({ length: 30 }, (_, i) => ({
      version: i + 1,
      content: `revision number ${i + 1}`,
      createdAt: '2026-08-02T10:00:00Z',
    })),
  },
  // `saudacao/prod` NÃO tem política: a promoção é livre, e a tela precisa dizer isso com todas as
  // letras. `saudacao/staging` tem — e é o lado que prova que a recusa do serviço chega inteira.
  // Sem os dois lados, o e2e provaria metade.
  policies: {
    'saudacao::staging': { datasetId: 'ds-saudacoes', minScore: 0.8 },
  },
  // Três formas de propósito, porque a coluna tem três estados e um e2e que só visse o primeiro
  // provaria um terço: v3 com uso e custo · v2 com uso e custo AUSENTE (o provider não reportou)
  // · v1 sem tráfego nenhum, que é diferente de zero.
  comentarios: {},
  uso: {
    saudacao: [
      { revision: 3, resolutions: 12, totalTokens: 1500, costUsd: 0.0312, p50LatencyMs: 4.2 },
      { revision: 2, resolutions: 4, totalTokens: 0, costUsd: null, p50LatencyMs: 3.1 },
    ],
    // M23 — um SEGUNDO prompt com uso, e é isso que torna a jornada capaz de discriminar.
    // Ele tem uso na aba e nenhuma resolução no explorador: se o destino ignorasse o filtro,
    // as três resoluções de `saudacao` apareceriam aqui e o teste cairia.
    despedida: [
      { revision: 1, resolutions: 2, totalTokens: 40, costUsd: null, p50LatencyMs: 1.8 },
    ],
  },
};

/**
 * M15 — o interruptor do estado "não consegui ler", que o DoD-3 exige que a tela saiba
 * distinguir de "ninguém usou".
 *
 * Vive em `sessionStorage` e não em `page.route` do Playwright por uma razão medida: estes
 * mocks são um wrap de `window.fetch`, NÃO rede real (ADR D1 — não é MSW). A interceptação do
 * Playwright nunca vê a requisição, e um teste escrito com ela passaria por acaso ou falharia
 * sem explicar. O e2e liga o interruptor com `addInitScript`, antes de qualquer script da
 * página — sem `goto` extra e sem parâmetro de URL, que a navegação SPA descartaria.
 */
function usoIndisponivel(): boolean {
  try {
    return globalThis.sessionStorage?.getItem('__mock_uso') === 'indisponivel';
  } catch {
    return false;
  }
}

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

    // M16 — o mock FILTRA, como o serviço. Um mock que ignora `search`/`tag`/`folder` devolveria
    // a lista inteira para uma busca, e o e2e ficaria verde sobre uma tela que exibe linhas que
    // não casam com o termo digitado — exatamente o modo de falha que o cabeçalho deste arquivo
    // já alerta duas vezes (`content` do catálogo, `variables` do prompt).
    const busca = (url.searchParams.get('search') ?? '').toLowerCase();
    const tag = url.searchParams.get('tag') ?? '';
    const pasta = url.searchParams.get('folder') ?? '';
    const casados = promptlyDb.catalog.filter((p) => {
      if (busca !== '' && !p.name.toLowerCase().includes(busca)) return false;
      if (pasta !== '' && !p.name.startsWith(`${pasta}/`)) return false;
      if (tag !== '' && !(p.tags ?? []).includes(tag)) return false;
      return true;
    });

    const pagina = casados.slice(0, limit);
    const temMais = casados.length > limit;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (temMais && pagina.length > 0) {
      const cursor = encodeURIComponent(pagina[pagina.length - 1]!.name);
      // O filtro viaja no Link, como no serviço: sem isso a página 2 volta ao catálogo inteiro.
      const extras = [
        busca !== '' ? `&search=${encodeURIComponent(busca)}` : '',
        tag !== '' ? `&tag=${encodeURIComponent(tag)}` : '',
        pasta !== '' ? `&folder=${encodeURIComponent(pasta)}` : '',
      ].join('');
      headers.Link = `<${base}/prompts?after=${cursor}&limit=${String(limit)}${extras}>; rel="next"`;
    }
    return new Response(JSON.stringify(pagina), { status: 200, headers });
  });

  /**
   * M18 — a discussão de UMA revisão.
   *
   * Sem esta rota o mock é MENOS fiel que a produção: a tela chama, a chamada falha, e o e2e passa
   * a exercitar o estado "não consegui ler a discussão" — que produção não terá. É o mesmo modo de
   * falha que o cabeçalho deste arquivo já alerta para o `content` do catálogo e as `variables` do
   * prompt, e que quebrou três jornadas quando o cartão de discussão nasceu.
   */
  registerRoute('GET', `${base}/prompts/{name}/revisions/{version}/comments`, async (_req, { name, version }) => {
    const chave = `${name ?? ''}\u001f${version ?? ''}`;
    return Response.json(promptlyDb.comentarios[chave] ?? []);
  });

  registerRoute('POST', `${base}/prompts/{name}/revisions/{version}/comments`, async (req, { name, version }) => {
    const corpo = (await req.json()) as { body?: string };
    const texto = (corpo.body ?? '').trim();
    if (texto === '') return Response.json({ error: 'empty_comment' }, { status: 400 });
    const chave = `${name ?? ''}\u001f${version ?? ''}`;
    const lista = promptlyDb.comentarios[chave] ?? [];
    lista.push({ id: `c-${String(lista.length + 1)}`, body: texto, author: 'operador', createdAt: '2026-08-04T12:00:00Z' });
    promptlyDb.comentarios[chave] = lista;
    return Response.json({ name, version }, { status: 201 });
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
  /**
   * M20 DoD-2 — o texto RESOLVIDO, numa rota própria.
   *
   * A resolução é feita aqui do mesmo jeito que o serviço faz — substituindo o marcador pelo
   * conteúdo da revisão referenciada — e não por um campo fixo na fixture. Um mock que devolvesse
   * texto pronto passaria mesmo se o serviço parasse de resolver: o e2e ficaria verde sobre a tela
   * exibindo um texto que o produto real não produz.
   */
  registerRoute('GET', `${base}/prompts/{name}/resolved`, async (_req, { name }) => {
    const alvo = decodeURIComponent(name);
    const revs = promptlyDb.revisions[alvo];
    if (!revs || revs.length === 0) {
      return Response.json({ error: 'prompt_not_found', name: alvo }, { status: 404 });
    }
    const ultima = revs[revs.length - 1]!;
    const resolvido = ultima.content.replace(
      /(?<!@)@@@promptly:name=([^@\s|]+)\|version=(\d+)@@@/g,
      (inteiro, nome: string, versao: string) => {
        const alvoRev = (promptlyDb.revisions[nome] ?? []).find((r) => r.version === Number(versao));
        return alvoRev?.content ?? inteiro;
      },
    );
    return Response.json({
      ...ultima,
      name: alvo,
      variables: variaveisDe(ultima.content),
      resolvedContent: resolvido,
    });
  });

  /**
   * M20 DoD-4 — quem me referencia, com o `via`.
   *
   * O `via` sai daqui derivado do MARCADOR, não de uma constante: é o mesmo dado que o serviço lê
   * da tabela de arestas, e derivá-lo mantém as duas pontas incapazes de divergir na fixture.
   */
  registerRoute('GET', `${base}/prompts/{name}/dependents`, async (_req, { name }) => {
    const alvo = decodeURIComponent(name);
    const out: { name: string; version: number; via: { version: number | null; label: string | null } }[] = [];
    for (const [nome, revs] of Object.entries(promptlyDb.revisions)) {
      for (const rev of revs) {
        for (const m of rev.content.matchAll(/(?<!@)@@@promptly:name=([^@\s|]+)\|(version|label)=([^@\s]+)@@@/g)) {
          if (m[1] !== alvo) continue;
          out.push({
            name: nome,
            version: rev.version,
            via: {
              version: m[2] === 'version' ? Number(m[3]) : null,
              label: m[2] === 'label' ? (m[3] ?? null) : null,
            },
          });
        }
      }
    }
    return Response.json(out);
  });

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

  // M15 — o uso observado por revisão. O mock respeita `windowDays` porque a tela DIZ a janela:
  // um mock que a ignorasse deixaria passar uma tela que mostra "7 dias" sobre outro período.
  registerRoute('GET', `${base}/prompts/{name}/usage`, async (req, { name }) => {
    const nome = decodeURIComponent(name);
    if (usoIndisponivel()) {
      // O estado que o DoD-3 exige que a tela saiba distinguir de "ninguém usou".
      return Response.json(
        { code: 'PROMPTLY_USAGE_UNAVAILABLE', message: 'could not read this prompt usage' },
        { status: 502 },
      );
    }
    const windowDays = Number(new URL(req.url).searchParams.get('windowDays') ?? '7');
    return Response.json({ promptName: nome, windowDays, rows: promptlyDb.uso[nome] ?? [] });
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
    else promptlyDb.catalog.push({ name: nome, latestVersion: version, labels: [], tags: [], updatedAt: '2026-08-03T12:00:00Z' });
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
          message: `rollback of "${nome}" needs the label to roll back — existing: ${entrada.labels.map((l) => l.label).join(', ')}`,
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
          message: `promotion requires score ≥ ${politica.minScore} on dataset ${politica.datasetId}; the best run of this revision scored 0.41`,
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
