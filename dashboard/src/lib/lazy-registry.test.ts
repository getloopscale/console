// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REGISTRO = readFileSync(resolve(__dirname, '../app-routes-lazy.ts'), 'utf8');

/**
 * B-003 — o registro de páginas contém APENAS declarações `lazy()`.
 *
 * ## Por que este guard existe
 *
 * `app.tsx` chegou a 779 linhas somando 85 declarações `lazy()`, 119 rotas, dois
 * redirects de link legado e um conserto de scroll-lock do Radix. Cada acréscimo
 * era defensável isolado; o que faltava era alguém somando.
 *
 * A extração separou as duas metades. Sem este teste, a próxima pessoa que
 * precisar de um redirect vai pô-lo aqui — "já que é sobre rotas" — e em alguns
 * meses o problema volta com um nome novo.
 *
 * ## A fronteira
 *
 * Declaração `lazy()` é REGISTRO: uma linha por página, sem lógica. Redirect,
 * guarda e aninhamento são DECISÃO DE ROTEAMENTO e moram em `app.tsx`, junto da
 * árvore que os aplica.
 */
describe('registro de páginas lazy (B-003)', () => {
  it('não há função nem componente declarado no registro', () => {
    const intrusos = [...REGISTRO.matchAll(/^export (?:default )?(function|class) (\w+)/gm)].map(
      (m) => `${m[1]} ${m[2]}`,
    );

    expect(
      intrusos,
      'Função declarada no registro de páginas.\n\n' +
        'Este arquivo é uma LISTA: uma linha por página carregada sob demanda.\n' +
        'Redirect, guarda e aninhamento são decisão de roteamento e moram em\n' +
        '`app.tsx`, junto da árvore que os aplica.\n\n' +
        'Foi somando "só mais uma coisa que é sobre rotas" que `app.tsx` chegou a\n' +
        '779 linhas.\n',
    ).toEqual([]);
  });

  it('todo export do registro é uma declaração lazy()', () => {
    const exports = [...REGISTRO.matchAll(/^export const (\w+)\s*=\s*(\w+)/gm)];
    const naoLazy = exports.filter(([, , chamada]) => chamada !== 'lazy').map(([, nome]) => nome);

    expect(naoLazy, 'Export que não é `lazy()` — o registro deixou de ser uma lista.').toEqual([]);
  });

  it('o registro tem conteúdo — um arquivo vazio passaria nos dois acima', () => {
    // Sem esta asserção, apagar o arquivo inteiro deixaria os dois casos verdes:
    // zero intrusos e zero exports não-lazy. É a mesma armadilha do `dist` vazio
    // em `check-mocks-tree-shaken.mjs`, e ela aparece toda vez que um teste
    // afirma uma AUSÊNCIA.
    expect(REGISTRO.match(/^export const \w+ = lazy\(/gm)?.length ?? 0).toBeGreaterThan(50);
  });
});
