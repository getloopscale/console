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
    expect(itens.map((i) => i.path)).toContain('/promptly/catalogo');
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
    expect(resolveActiveMenu('/promptly/catalogo')).toEqual({ id: 'promptly' });
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
