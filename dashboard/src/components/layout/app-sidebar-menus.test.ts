import { describe, expect, it } from 'vitest';

import { MENUS, resolveActiveMenu } from './app-sidebar-menus';

/**
 * M13 — a navegação tem DUAS metades, e a segunda é a que ninguém lembra.
 *
 * Declarar o submenu não basta. No `theo-trust` (M23) as quatro telas foram declaradas, e **nunca
 * abriram**, porque faltava a linha em `resolveActiveMenu` — e três rodadas de validação passaram
 * por cima disso, porque validavam abrindo a URL, que é o único caminho que o usuário real não tem.
 *
 * Este arquivo existe para que a omissão pare de ser detectável só por inspeção humana. Ele prova a
 * RESOLUÇÃO; o alcance por clique é asserido no e2e da jornada.
 */
describe('submenu do promptly', () => {
  const itens = MENUS.promptly.groups.flatMap((g) => g.items);

  it('declara o painel na raiz da capacidade', () => {
    expect(itens.map((i) => i.path)).toContain('/promptly');
  });

  it('declara o catálogo, que saiu da raiz no M13', () => {
    expect(itens.map((i) => i.path)).toContain('/promptly/catalog');
  });

  it('rotula a raiz como painel, não como lista', () => {
    const raiz = itens.find((i) => i.path === '/promptly');
    // Até o M13 o rótulo era `Overview` sobre uma tabela — prometia painel e entregava lista.
    expect(raiz?.label).not.toMatch(/catálogo|catalogo|lista/i);
  });
});

describe('resolveActiveMenu', () => {
  it('reconhece a raiz da capacidade', () => {
    expect(resolveActiveMenu('/promptly')).toEqual({ id: 'promptly' });
  });

  it('reconhece a rota do catálogo — a metade que faz o menu ABRIR', () => {
    expect(resolveActiveMenu('/promptly/catalog')).toEqual({ id: 'promptly' });
  });

  it('continua reconhecendo as rotas que já existiam', () => {
    expect(resolveActiveMenu('/promptly/new')).toEqual({ id: 'promptly' });
    expect(resolveActiveMenu('/promptly/saudacao')).toEqual({ id: 'promptly' });
    expect(resolveActiveMenu('/promptly/saudacao/diff')).toEqual({ id: 'promptly' });
  });

  // EC-9 — `startsWith('/promptly')` casa `/promptlyfoo`. Não há rota assim hoje; o teste custa
  // uma linha e trava a classe de bug antes que exista uma.
  it('não reconhece um prefixo que não é a capacidade', () => {
    expect(resolveActiveMenu('/promptlyfoo')).not.toEqual({ id: 'promptly' });
  });
});

/**
 * M14 — o playground fica DENTRO da capacidade, e o submenu tem de saber disso.
 *
 * Não há item de menu para o playground de propósito: ele é sempre de UM prompt,
 * e um item levaria a uma tela que não sabe de qual. O que precisa continuar
 * verdadeiro é o realce — entrar no playground não pode "sair" da capacidade aos
 * olhos de quem navega.
 */
describe('resolveActiveMenu — o playground do M14', () => {
  it('mantem o submenu promptly ativo dentro do playground de um prompt', () => {
    expect(resolveActiveMenu('/promptly/saudacao/playground')).toEqual({ id: 'promptly' });
  });

  /**
   * Restrito ao promptly de propósito: o `memory` TEM um playground de menu, e ele
   * é legítimo — aquele não é de um recurso específico. A primeira versão desta
   * asserção varria todos os menus e reprovou por causa dele, o que foi o teste
   * corrigindo a asserção em vez do código.
   */
  it('o submenu promptly nao lista playground — seria um item levando a uma tela sem prompt', () => {
    const promptly = MENUS.promptly;
    const itens = (promptly?.groups ?? []).flatMap((g) => g.items ?? []);
    expect(itens.map((i) => i.path).filter((p) => p?.includes('/playground'))).toEqual([]);
    // Anti-verde-vazio: se a leitura da estrutura quebrar, o filtro devolveria [] sem discriminar.
    expect(itens.length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * Capacidades anunciadas e não construídas.
 *
 * O menu de Capabilities é onde alguém conta o que o produto entrega — e uma
 * entrada indistinguível das prontas infla essa conta. `comingSoon` é o que
 * separa anunciar um roadmap de afirmar uma entrega.
 *
 * Estes testes protegem o par: a entrada existe E está marcada. Tirar o marcador
 * sem entregar a tela é a regressão silenciosa que eles pegam — o item continua
 * lá, clicável, agora parecendo pronto.
 */
describe('capacidades marcadas como em breve', () => {
  const capabilities = MENUS.main.groups.find((g) => g.title === 'Capabilities');

  it('o grupo Capabilities existe — o resto depende disto', () => {
    expect(capabilities, 'grupo "Capabilities" sumiu do menu principal').toBeDefined();
  });

  it('Databases está declarada e MARCADA como em breve', () => {
    const db = capabilities?.items.find((i) => i.label === 'Databases');
    expect(db, 'a entrada Databases sumiu do menu').toBeDefined();
    expect(
      db?.comingSoon,
      'Databases perdeu o marcador `comingSoon`. Se a tela foi entregue, remova também\n' +
        'o placeholder da rota /databases em app.tsx — os dois saem juntos. Se não foi,\n' +
        'o marcador é o que impede a entrada de afirmar uma entrega que não houve.',
    ).toBe(true);
  });

  it('toda entrada marcada tem rota própria — nenhuma leva a lugar nenhum', () => {
    const marcadas = MENUS.main.groups.flatMap((g) => g.items).filter((i) => i.comingSoon);
    expect(marcadas.length, 'nenhuma capacidade marcada — este teste ficou sem objeto').toBeGreaterThan(0);
    for (const i of marcadas) {
      expect(i.path, `"${i.label}" está marcada mas não declara path`).toMatch(/^\//);
    }
  });

  it('as capacidades ENTREGUES não carregam o marcador', () => {
    const entregues = ['Memory', 'Knowledge Base', 'Observability', 'Trust', 'Skills', 'Prompts'];
    const marcadasIndevidamente = capabilities?.items
      .filter((i) => entregues.includes(i.label) && i.comingSoon)
      .map((i) => i.label);
    expect(
      marcadasIndevidamente,
      'Capacidade entregue marcada como em breve — o erro oposto, e igualmente caro:\n' +
        'esconde do usuário algo que já funciona.',
    ).toEqual([]);
  });
});
