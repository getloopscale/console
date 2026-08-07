import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));

const mockCatalog = vi.fn();
vi.mock('@/pages/promptly/components/promptly-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pages/promptly/components/promptly-api')>();
  return { ...actual, fetchCatalogPage: (...a: unknown[]) => mockCatalog(...a) };
});

import { PromptlyCatalogoPage } from './catalogo';

/**
 * M13 — o catálogo, agora com busca. E é a busca que cria o problema que este arquivo trava.
 *
 * Até aqui a tela distinguia DOIS estados que produzem telas parecidas e significam coisas opostas:
 * "leu e não há nada" (pode afirmar ausência) e "não conseguiu ler" (o vazio é ignorância). Filtrar
 * acrescenta um TERCEIRO — "há prompts, nenhum casa com o termo" — e ele não pode herdar a saída de
 * nenhum dos dois: oferecer "crie o primeiro prompt" a quem filtrou afirma que o workspace está
 * vazio quando ele não está, e o que falta é limpar o filtro.
 */

const CATALOGO = [
  { name: 'saudacao', latestVersion: 3, labels: [{ label: 'prod', version: 1 }], updatedAt: '2026-08-01T10:00:00Z' },
  { name: 'despedida', latestVersion: 1, labels: [], updatedAt: '2026-07-30T09:00:00Z' },
  { name: 'agentbuilder-base', latestVersion: 2, labels: [{ label: 'prod', version: 2 }], updatedAt: '2026-08-02T09:00:00Z' },
];

beforeEach(() => {
  mockCatalog.mockReset();
});

describe('PromptlyCatalogoPage', () => {
  it('lista os prompts do workspace pelo NOME', async () => {
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyCatalogoPage />);

    expect(await screen.findByText('saudacao')).toBeInTheDocument();
    expect(screen.getByText('agentbuilder-base')).toBeInTheDocument();
  });

  // M16 — a busca MUDOU DE LADO. Até aqui ela filtrava a página já carregada; agora o termo vai
  // ao servidor. Do ponto de vista de quem digita o efeito é o mesmo com 14 prompts — e é
  // exatamente por isso que o oráculo tem de ser a CHAMADA: uma tela que recebesse tudo e
  // filtrasse em memória passaria numa asserção sobre as linhas visíveis, e mentiria com 500.
  it('filtra por substring do nome — no servidor', async () => {
    // O dublê FILTRA, como o servidor faria. Um mock que devolve tudo deixaria a tela exibindo
    // `saudacao` para uma busca por `agent` sem nada acusar — e as duas metades da asserção
    // (a chamada E as linhas) são necessárias: só a chamada não prova que a tela usou a
    // resposta; só as linhas não distinguem servidor de memória.
    mockCatalog.mockImplementation((_l: number, f: { search?: string }) =>
      Promise.resolve({
        data: f?.search ? CATALOGO.filter((r) => r.name.includes(f.search!)) : CATALOGO,
        temContinuacao: false,
      }),
    );
    render(<PromptlyCatalogoPage />);
    await screen.findByText('saudacao');

    await userEvent.type(screen.getByRole('searchbox'), 'agent');

    await vi.waitFor(() =>
      expect(mockCatalog).toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({ search: 'agent' }),
      ),
    );
    expect(await screen.findByText('agentbuilder-base')).toBeInTheDocument();
    expect(screen.queryByText('saudacao')).not.toBeInTheDocument();
  });

  // O teste que sustenta as três dispensas de concorrência das tarefas T3.x: elas dizem
  // "(none — single-threaded) … coberta pelo teste de que digitar rápido não dispara uma busca
  // por tecla". Sem ele, a dispensa se apoiava num teste ausente.
  it('digitar rapido NAO dispara uma busca por tecla', async () => {
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: false });
    render(<PromptlyCatalogoPage />);
    await screen.findByText('saudacao');
    const antes = mockCatalog.mock.calls.length;

    await userEvent.type(screen.getByRole('searchbox'), 'saudac');

    await vi.waitFor(() =>
      expect(mockCatalog).toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({ search: 'saudac' }),
      ),
    );
    // Seis teclas, UMA busca a mais. Sem o debounce seriam seis — e seis entradas no histórico.
    expect(mockCatalog.mock.calls.length - antes).toBe(1);
  });

  // EC-7 — o extremo VÁLIDO da busca: vazia devolve tudo, não nada.
  it('busca vazia devolve todas as linhas', async () => {
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: false });
    render(<PromptlyCatalogoPage />);
    await screen.findByText('saudacao');

    await userEvent.type(screen.getByRole('searchbox'), 'a');
    await userEvent.clear(screen.getByRole('searchbox'));

    expect(screen.getByText('saudacao')).toBeInTheDocument();
    expect(screen.getByText('despedida')).toBeInTheDocument();
  });

  // EC-7 — o primeiro INVÁLIDO logo após: caractere de regex não pode estourar. Trava o uso de
  // `includes` contra um refactor para `new RegExp(termo)`, que lançaria SyntaxError em input legítimo.
  // A intenção do EC-7 sobrevive à mudança de lado: `a(b` é input legítimo de quem digita, e não
  // pode estourar. O que mudou é onde ele é tratado — agora vai ao servidor como texto, e o
  // adaptador Postgres escapa `%`/`_` pela mesma razão que a tela nunca montou `RegExp`.
  it('busca com caractere de regex não quebra a tela', async () => {
    mockCatalog.mockResolvedValue({ data: [], temContinuacao: false });
    render(<PromptlyCatalogoPage />);

    await userEvent.type(await screen.findByRole('searchbox'), 'a(b');

    await vi.waitFor(() =>
      expect(mockCatalog).toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({ search: 'a(b' }),
      ),
    );
  });

  // REMOVIDO no M16, e a remoção é o ponto. Este teste exigia a frase "o filtro roda sobre os
  // prompts já carregados nesta página" — verdadeira no M13 e FALSA agora. Mantê-la seria pior
  // que antes: uma desculpa por uma limitação que deixou de existir. O inverso está travado em
  // 'a frase "roda sobre os ja carregados" NAO existe mais na tela'.

  // ---- os TRÊS estados vazios (MUST FIX EC-2) ----

  it('falha de leitura NÃO oferece criar — o vazio é ignorância, não ausência', async () => {
    mockCatalog.mockRejectedValue(new Error('502'));

    render(<PromptlyCatalogoPage />);

    expect(await screen.findByText(/não foi possível carregar/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /criar o primeiro/i })).not.toBeInTheDocument();
  });

  it('vazio de verdade oferece criar', async () => {
    mockCatalog.mockResolvedValue({ data: [], temContinuacao: false });

    render(<PromptlyCatalogoPage />);

    expect(await screen.findByRole('link', { name: /criar o primeiro/i })).toBeInTheDocument();
  });

  it('filtro sem resultado NÃO diz que o workspace está vazio', async () => {
    // M16 — o dublê passa a se comportar como o SERVIDOR: com termo, devolve o conjunto
    // filtrado. Um mock que ignora o filtro devolveria linhas para uma busca sem resultado, e o
    // teste exercitaria um estado que a tela nunca vê.
    mockCatalog.mockImplementation((_l: number, f: { search?: string }) =>
      Promise.resolve({ data: f?.search ? [] : CATALOGO, temContinuacao: false }),
    );
    render(<PromptlyCatalogoPage />);
    await screen.findByText('saudacao');

    await userEvent.type(screen.getByRole('searchbox'), 'zzz');

    // Nem afirma ausência, nem oferece criar: o que falta é limpar o filtro.
    expect(await screen.findByRole('button', { name: /limpar/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /criar o primeiro/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/nenhum prompt neste workspace/i)).not.toBeInTheDocument();
  });

  // ---- T4.1 — comparar a um clique ----

  it('a linha leva a comparar em um clique', async () => {
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyCatalogoPage />);

    const link = await screen.findByRole('link', { name: /comparar revisões de saudacao/i });
    expect(link).toHaveAttribute('href', '/promptly/saudacao/diff');
  });

  it('prompt com uma única revisão não oferece comparar', async () => {
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyCatalogoPage />);
    await screen.findByText('despedida');

    // `despedida` está em v1 — não há duas revisões para comparar.
    expect(screen.queryByRole('link', { name: /comparar revisões de despedida/i })).not.toBeInTheDocument();
  });

  // EC-10 — nomes não têm restrição de caractere (`name: z.string().min(1)`). Sem escape,
  // `a/b` vira `/promptly/a/b/diff`, que NÃO casa com a rota `/promptly/:name/diff`.
  it('o link de comparar escapa nome com barra', async () => {
    mockCatalog.mockResolvedValue({
      data: [{ name: 'time/saudacao', latestVersion: 2, labels: [], updatedAt: '2026-08-01T10:00:00Z' }],
      temContinuacao: false,
    });

    render(<PromptlyCatalogoPage />);

    const link = await screen.findByRole('link', { name: /comparar revisões de time\/saudacao/i });
    expect(link).toHaveAttribute('href', '/promptly/time%2Fsaudacao/diff');
  });
});

/**
 * Migrados de `pages/promptly.test.tsx` no M13, quando a lista saiu da raiz da capacidade.
 * O comportamento não mudou de dono — a tela é que mudou de endereço.
 */
describe('PromptlyCatalogoPage — herdado do M25', () => {
  it('diz para onde cada ambiente aponta, que é a pergunta que traz o operador aqui', async () => {
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyCatalogoPage />);

    expect(await screen.findByText('prod → v1')).toBeInTheDocument();
  });

  it('descreve como "nenhum" o prompt que não serve ambiente algum', async () => {
    // Estado normal do dado, distinto de "não sei": o prompt existe e nenhum label o aponta.
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyCatalogoPage />);

    expect(await screen.findByText('nenhum')).toBeInTheDocument();
  });

  it('pede um limite EXPLÍCITO ao servidor em vez de herdar o teto dele', async () => {
    mockCatalog.mockResolvedValue({ data: [], temContinuacao: false });

    render(<PromptlyCatalogoPage />);

    await screen.findByText(/Nenhum prompt neste workspace/i);
    expect(mockCatalog).toHaveBeenCalledWith(expect.any(Number), expect.any(Object));
    expect(mockCatalog.mock.calls[0][0]).toBeGreaterThan(0);
  });
});

/**
 * M13 pós-review — o que CINCO revisores independentes encontraram: o milestone construiu no painel
 * a disciplina de "não afirmar o que não se sabe" e não a aplicou a esta tela.
 */
describe('PromptlyCatalogoPage — a contagem não pode afirmar o que não sabe', () => {
  // FE-01: o defeito era imprimir "0 neste workspace" DURANTE a falha, duas linhas abaixo de um
  // alerta dizendo o contrário. A mais numérica das três afirmações simultâneas era a falsa.
  it('não afirma contagem alguma quando a leitura falhou', async () => {
    mockCatalog.mockRejectedValue(new Error('502'));

    render(<PromptlyCatalogoPage />);

    expect(await screen.findByText(/não foi possível carregar/i)).toBeInTheDocument();
    // A regex mira a CONTAGEM (número + frase). O texto do Alert também diz "neste workspace",
    // e ele está certo — é justamente ele que nega o zero.
    expect(screen.queryByText(/\d+ neste workspace/i)).not.toBeInTheDocument();
  });

  it('não afirma contagem alguma enquanto carrega', () => {
    mockCatalog.mockReturnValue(new Promise(() => { /* pendente de propósito */ }));

    render(<PromptlyCatalogoPage />);

    expect(screen.queryByText(/\d+ neste workspace/i)).not.toBeInTheDocument();
  });

  // B1 / FE-02 — o par que discrimina, na tela da lista.
  it('com continuação, a contagem NÃO diz "neste workspace"', async () => {
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: true });

    render(<PromptlyCatalogoPage />);

    expect(await screen.findByText(/há mais no servidor/i)).toBeInTheDocument();
    expect(screen.queryByText(/\d+ neste workspace/i)).not.toBeInTheDocument();
  });

  it('sem continuação, a contagem PODE dizer "neste workspace"', async () => {
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyCatalogoPage />);

    expect(await screen.findByText(/3 neste workspace/i)).toBeInTheDocument();
  });

  // FE-04 — o estado que mais precisa de saída era o único sem ela.
  it('a falha de leitura oferece tentar novamente', async () => {
    mockCatalog.mockRejectedValue(new Error('502'));

    render(<PromptlyCatalogoPage />);

    expect(await screen.findAllByRole('button', { name: /tentar novamente/i })).not.toHaveLength(0);
  });

  // B1 agravante — com continuação, o filtro não pode afirmar ausência no WORKSPACE: o prompt
  // procurado pode estar na página que esta tela não trouxe.
  // M16 — o caso continua valendo, e ficou MAIS forte: com a busca no servidor, uma página
  // filtrada e truncada significa "o servidor achou mais do que coube aqui". Afirmar ausência
  // sobre isso seria o falso total do M13 por outra porta.
  it('filtro sem resultado com continuação não afirma ausência no workspace', async () => {
    mockCatalog.mockImplementation((_l: number, f: { search?: string }) =>
      Promise.resolve({ data: f?.search ? [] : CATALOGO, temContinuacao: true }),
    );
    render(<PromptlyCatalogoPage />);
    await screen.findByText('saudacao');

    await userEvent.type(screen.getByRole('searchbox'), 'zzz');

    expect(await screen.findByText(/há mais no servidor/i)).toBeInTheDocument();
    expect(screen.queryByText(/O workspace tem prompts/i)).not.toBeInTheDocument();
  });
});

/**
 * B2 (XV-M13-02) — o DoD-3 termina com "cada número leva à lista correspondente". A primeira
 * versão renderizou os KPIs sem link E sem lista correspondente, e a Coverage Matrix afirmou
 * "linkados". Estes casos travam a metade que faltava: a lista existe e o recorte vive no
 * ENDEREÇO, para o link do painel ser colável.
 */
describe('PromptlyCatalogoPage — recortes vindos do endereço', () => {
  it('recorta por não-promovidos quando o endereço pede', async () => {
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyCatalogoPage />, { initialEntries: ['/promptly/catalogo?recorte=nao-promovidos'] });

    // `saudacao` (v3, prod→v1) e `despedida` (v1, sem label) não estão no ar; `agentbuilder-base`
    // (v2, prod→v2) está.
    expect(await screen.findByText('saudacao')).toBeInTheDocument();
    expect(screen.getByText('despedida')).toBeInTheDocument();
    expect(screen.queryByText('agentbuilder-base')).not.toBeInTheDocument();
  });

  it('anuncia o recorte ativo e oferece a saída dele', async () => {
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyCatalogoPage />, { initialEntries: ['/promptly/catalogo?recorte=nao-promovidos'] });

    expect(await screen.findByRole('heading', { name: /não promovidos/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ver todos/i })).toBeInTheDocument();
  });

  // Um recorte desconhecido (endereço antigo, link editado à mão) mostra a lista inteira — nunca
  // um erro, e nunca uma lista vazia que afirmaria ausência.
  it('recorte desconhecido é ignorado, não vira erro nem lista vazia', async () => {
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyCatalogoPage />, { initialEntries: ['/promptly/catalogo?recorte=inventado'] });

    expect(await screen.findByText('saudacao')).toBeInTheDocument();
    expect(screen.getByText('agentbuilder-base')).toBeInTheDocument();
  });
});

/**
 * M13 pós-aceitação — o critério que a própria implementação tornou difícil de verificar.
 *
 * A aceitação de 2026-08-03 devolveu `NOT_VALIDATED` com o AC2 `not_exercised`, e a razão está
 * registrada lá: o DoD exige ver a marca de parcialidade NA TELA; a tela pedia `limit=100` fixo; o
 * ambiente tem 12 prompts. As duas coisas não podem ser verdadeiras ao mesmo tempo sem encher um
 * workspace compartilhado — cujas revisões são imutáveis e não têm DELETE — de mais de cem prompts
 * de teste que ficariam lá para sempre.
 *
 * O conserto não é relaxar o critério: é dar à tela o que um acervo real vai exigir de qualquer
 * forma — pedir uma página menor. Aí a continuação é alcançável com 12 prompts, e o operador ganha
 * um controle que serve a ele, não ao teste.
 *
 * O tamanho vive no ENDEREÇO pela mesma razão que o recorte vive: o link tem de ser colável.
 */
describe('PromptlyCatalogoPage — o tamanho de página é escolha, e vive no endereço', () => {
  it('pede ao servidor o tamanho que o endereço declara', async () => {
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: true });

    render(<PromptlyCatalogoPage />, { initialEntries: ['/promptly/catalogo?porPagina=10'] });

    await screen.findByText('saudacao');
    expect(mockCatalog).toHaveBeenCalledWith(10, expect.any(Object));
  });

  it('trocar o tamanho refaz a busca com o novo limite', async () => {
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: false });
    render(<PromptlyCatalogoPage />);
    await screen.findByText('saudacao');

    await userEvent.selectOptions(screen.getByLabelText(/prompts por página/i), '10');

    // A chave da consulta tem de carregar o tamanho: sem isso o React Query devolve a página
    // anterior do cache e a tela mostra 100 itens dizendo que pediu 10.
    await vi.waitFor(() => expect(mockCatalog).toHaveBeenCalledWith(10, expect.any(Object)));
  });

  it('com a página menor e continuação, a contagem se declara PARCIAL', async () => {
    // É este o par que o AC2 pede, e que o ambiente não conseguia produzir antes.
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: true });

    render(<PromptlyCatalogoPage />, { initialEntries: ['/promptly/catalogo?porPagina=10'] });

    expect(await screen.findByText(/há mais no servidor/i)).toBeInTheDocument();
    expect(screen.queryByText(/neste workspace/i)).not.toBeInTheDocument();
  });

  it('pagina CHEIA sem continuação nao e parcial — o controle negativo do Top-risk 2', async () => {
    // O falso positivo exato que `rows.length === limit` produziria: dez linhas, página de dez,
    // e o servidor dizendo que acabou. É o total, e marcá-lo de parcial ensinaria o operador a
    // desconfiar de um número correto — pior do que não mostrar número algum.
    //
    // A página precisa estar CHEIA para o teste valer: com três linhas numa página de dez a
    // heurística não dispararia nem se existisse, e o teste passaria sem exercitar nada.
    const dez = Array.from({ length: 10 }, (_, i) => ({
      name: `prompt-${String(i)}`,
      latestVersion: 1,
      labels: [],
      updatedAt: '2026-08-01T10:00:00Z',
    }));
    mockCatalog.mockResolvedValue({ data: dez, temContinuacao: false });

    render(<PromptlyCatalogoPage />, { initialEntries: ['/promptly/catalogo?porPagina=10'] });

    expect(await screen.findByText(/10 neste workspace/i)).toBeInTheDocument();
    expect(screen.queryByText(/há mais no servidor/i)).not.toBeInTheDocument();
  });

  it('tamanho invalido no endereco cai no padrao em vez de virar erro', async () => {
    // Endereço editado à mão ou link antigo. Mesma regra do recorte desconhecido: ignora e mostra,
    // nunca um erro — e nunca um `limit=NaN` que o servidor recusaria.
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyCatalogoPage />, { initialEntries: ['/promptly/catalogo?porPagina=abacaxi'] });

    await screen.findByText('saudacao');
    expect(mockCatalog.mock.calls[0][0]).toBeGreaterThan(0);
    expect(Number.isNaN(mockCatalog.mock.calls[0][0])).toBe(false);
  });

  it('limpar o recorte PRESERVA o tamanho de pagina escolhido', async () => {
    // O `setParams({})` de hoje apagaria os dois. Perder o tamanho ao clicar "Ver todos" mandaria
    // a tela buscar 100 sem o operador ter pedido — e a marca de parcialidade sumiria com ele.
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: true });

    render(<PromptlyCatalogoPage />, {
      initialEntries: ['/promptly/catalogo?recorte=nao-promovidos&porPagina=10'],
    });
    await screen.findByRole('button', { name: /ver todos/i });

    await userEvent.click(screen.getByRole('button', { name: /ver todos/i }));

    expect(await screen.findByText('agentbuilder-base')).toBeInTheDocument();
    expect(screen.getByLabelText(/prompts por página/i)).toHaveValue('10');
  });
});

/**
 * M16 — o filtro roda no SERVIDOR, e a tela para de se desculpar.
 *
 * O M13 entregou o catálogo com uma frase que precisava ser dita: *"o filtro roda sobre os prompts
 * já carregados nesta página, não sobre o servidor"*. Essa honestidade era o sintoma — com 500
 * prompts ela vira uma desculpa por um resultado errado. Agora o termo vai ao servidor, e a frase
 * deixa de existir porque deixou de ser verdade.
 */
describe('PromptlyCatalogoPage — a busca roda no servidor (M16)', () => {
  it('o termo do endereco vai para o SERVIDOR, nao filtra localmente', async () => {
    // O oráculo é a CHAMADA: uma tela que recebesse tudo e filtrasse em memória mostraria as
    // mesmas linhas neste teste. Só a chamada distingue as duas implementações.
    mockCatalog.mockResolvedValue({ data: [CATALOGO[0]], temContinuacao: false });

    render(<PromptlyCatalogoPage />, { initialEntries: ['/promptly/catalogo?busca=saudacao'] });

    await screen.findByText('saudacao');
    expect(mockCatalog).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ search: 'saudacao' }),
    );
  });

  it('a frase "roda sobre os ja carregados" NAO existe mais na tela', async () => {
    // O DoD pede isto pelo nome: a frase some porque deixou de ser verdade. Mantê-la seria pior
    // que antes — uma desculpa por uma limitação que não existe mais.
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyCatalogoPage />);

    await screen.findByText('saudacao');
    // A asserção proíbe a FAMÍLIA, não a frase exata: uma paráfrase da mesma desculpa
    // ("nenhum dos prompts carregados…") passaria por um `queryByText` literal, e foi assim que
    // ela sobreviveu à primeira entrega deste milestone.
    expect(screen.queryByText(/carregad/i)).not.toBeInTheDocument();
  });

  it('busca sem resultado diz que o SERVIDOR nao achou, e nao que o workspace esta vazio', async () => {
    mockCatalog.mockResolvedValue({ data: [], temContinuacao: false });

    render(<PromptlyCatalogoPage />, { initialEntries: ['/promptly/catalogo?busca=zzz'] });

    expect(await screen.findByText(/nenhum prompt casa/i)).toBeInTheDocument();
    expect(screen.queryByText(/nenhum prompt neste workspace/i)).not.toBeInTheDocument();
  });

  it('o termo vive no ENDERECO — o link e colavel', async () => {
    mockCatalog.mockResolvedValue({ data: CATALOGO, temContinuacao: false });
    render(<PromptlyCatalogoPage />);
    await screen.findByText('saudacao');

    await userEvent.type(screen.getByLabelText(/filtrar prompts por nome/i), 'lt033');

    await vi.waitFor(() =>
      expect(mockCatalog).toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({ search: 'lt033' }),
      ),
    );
  });

  it('com filtro ativo a contagem NAO diz "neste workspace"', async () => {
    // O DoD-4 do M16: o número continua honesto. Uma página filtrada não conhece o total do
    // workspace — dizê-lo seria o limite inferior apresentado como total que o M13 eliminou.
    mockCatalog.mockResolvedValue({ data: [CATALOGO[0]], temContinuacao: false });

    render(<PromptlyCatalogoPage />, { initialEntries: ['/promptly/catalogo?busca=saudacao'] });

    await screen.findByText('saudacao');
    expect(screen.queryByText(/neste workspace/i)).not.toBeInTheDocument();
  });
});

describe('PromptlyCatalogoPage — tags (M16)', () => {
  const COM_TAGS = [
    { ...CATALOGO[0], tags: ['suporte', 'campanha'] },
    { ...CATALOGO[1], tags: [] },
  ];

  it('a tag aparece na linha do catalogo', async () => {
    mockCatalog.mockResolvedValue({ data: COM_TAGS, temContinuacao: false });

    render(<PromptlyCatalogoPage />);

    expect(await screen.findByText('suporte')).toBeInTheDocument();
    expect(screen.getByText('campanha')).toBeInTheDocument();
  });

  it('prompt sem tag nao quebra a linha nem inventa marcacao', async () => {
    mockCatalog.mockResolvedValue({ data: COM_TAGS, temContinuacao: false });

    render(<PromptlyCatalogoPage />);

    // A linha existe; só não tem tag. Um `undefined` iterado quebraria a tabela inteira.
    expect(await screen.findByText('despedida')).toBeInTheDocument();
  });

  it('clicar numa tag filtra por ela, no servidor, e o filtro vive no endereco', async () => {
    mockCatalog.mockResolvedValue({ data: COM_TAGS, temContinuacao: false });
    render(<PromptlyCatalogoPage />);
    await screen.findByText('suporte');

    await userEvent.click(screen.getByRole('button', { name: /filtrar por suporte/i }));

    await vi.waitFor(() =>
      expect(mockCatalog).toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({ tag: 'suporte' }),
      ),
    );
  });

  it('o filtro por tag e anunciado e tem saida', async () => {
    mockCatalog.mockResolvedValue({ data: COM_TAGS, temContinuacao: false });

    render(<PromptlyCatalogoPage />, { initialEntries: ['/promptly/catalogo?tag=suporte'] });

    await screen.findByText('saudacao');
    expect(screen.getByRole('button', { name: /ver todos/i })).toBeInTheDocument();
  });
});

describe('PromptlyCatalogoPage — pastas (M16)', () => {
  const EM_PASTAS = [
    { name: 'suporte/saudacao', latestVersion: 1, labels: [], tags: [], updatedAt: '2026-08-01T10:00:00Z' },
    { name: 'vendas/saudacao', latestVersion: 1, labels: [], tags: [], updatedAt: '2026-08-01T10:00:00Z' },
    { name: 'solto', latestVersion: 1, labels: [], tags: [], updatedAt: '2026-08-01T10:00:00Z' },
  ];

  it('dois prompts com o mesmo nome final em pastas diferentes coexistem e sao distinguiveis', async () => {
    // O DoD pede isto pelo nome. Como a pasta é prefixo do NOME (ADR-2), eles já são chaves
    // distintas — a tela tem de mostrar os dois sem fundi-los nem repetir o mesmo link.
    mockCatalog.mockResolvedValue({ data: EM_PASTAS, temContinuacao: false });

    render(<PromptlyCatalogoPage />);

    expect(await screen.findByText('suporte/saudacao')).toBeInTheDocument();
    expect(screen.getByText('vendas/saudacao')).toBeInTheDocument();
  });

  it('a raiz oferece as pastas E os prompts soltos — catalogo plano continua navegavel', async () => {
    // O controle negativo que o DoD nomeia: quem nunca criou pasta não pode encontrar a raiz
    // vazia. As pastas são um atalho A MAIS, nunca um nível obrigatório.
    mockCatalog.mockResolvedValue({ data: EM_PASTAS, temContinuacao: false });

    render(<PromptlyCatalogoPage />);

    expect(await screen.findByText('solto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /abrir a pasta suporte/i })).toBeInTheDocument();
  });

  it('entrar numa pasta filtra no servidor e oferece a saida', async () => {
    mockCatalog.mockResolvedValue({ data: EM_PASTAS, temContinuacao: false });
    render(<PromptlyCatalogoPage />);
    await screen.findByText('solto');

    await userEvent.click(screen.getByRole('button', { name: /abrir a pasta suporte/i }));

    await vi.waitFor(() =>
      expect(mockCatalog).toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({ folder: 'suporte' }),
      ),
    );
    expect(screen.getByRole('button', { name: /ver todos/i })).toBeInTheDocument();
  });
});
