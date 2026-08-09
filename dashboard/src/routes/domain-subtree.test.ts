import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');
const APP = readFileSync(join(SRC, 'app.tsx'), 'utf8');

/**
 * B-003 — um domínio com muitas rotas mora no arquivo dele, não no `app.tsx`.
 *
 * ## O estado que esta regra reprova
 *
 * `app.tsx` tinha 119 rotas de ~15 domínios em 592 linhas (780 antes do primeiro
 * corte). Todo domínio novo entrava ali, porque ali era onde os outros estavam —
 * e nada media isso. O arquivo crescia por gravidade.
 *
 * A regra é sobre CONCENTRAÇÃO, não sobre tamanho: um domínio com 4 ou mais
 * rotas é grande o bastante para ter dono próprio. Abaixo disso, exigir arquivo
 * produziria uma dúzia de arquivos de duas linhas, que é o oposto do que o
 * `ADR-0001` quer.
 *
 * ## O que ela deixa passar de propósito
 *
 * As rotas de autenticação (`/login`, `/recovery`, …) ficam no `app.tsx`: elas
 * são a metade PÚBLICA da árvore, e `route-boundary.test.ts` verifica a
 * fronteira lendo esse arquivo. Espalhá-las tiraria a fronteira de vista.
 *
 * Redirects soltos e aliases também ficam — são decisão de roteamento, não
 * domínio, e `PreviewsRedirect`/`RepositoryAlias` existem para isso.
 */

const TETO_POR_DOMINIO = 3;

/** Domínios que legitimamente moram no `app.tsx`. */
const PUBLICOS = new Set([
  'login', 'register', 'signup', 'registration', 'verification',
  'auth', 'recovery', 'device-success', 'device-verify', '*', '',
]);

function rotasPorDominio(texto: string): Map<string, number> {
  const contagem = new Map<string, number>();
  // `<Route path=` e NÃO `path=` solto: cada linha de rota tem DOIS — o do
  // `<Route>` e o do `<Boundaried>` que ele envolve. Contar os dois dobrava o
  // número e teria feito a regra reprovar um domínio de duas rotas como se
  // tivesse quatro.
  for (const m of texto.matchAll(/<Route\s+path="([^"]+)"/g)) {
    const dom = m[1].replace(/^\//, '').split('/')[0];
    if (PUBLICOS.has(dom)) continue;
    contagem.set(dom, (contagem.get(dom) ?? 0) + 1);
  }
  return contagem;
}

describe('subtree por domínio (B-003)', () => {
  it('nenhum domínio concentra rotas demais dentro do app.tsx', () => {
    const excedentes = [...rotasPorDominio(APP)]
      .filter(([, n]) => n > TETO_POR_DOMINIO)
      .map(([dom, n]) => `${dom}: ${n} rotas no app.tsx (teto ${TETO_POR_DOMINIO})`)
      .sort();

    expect(
      excedentes,
      'Domínio com rotas demais declaradas dentro do `app.tsx`.\n\n' +
        'O arquivo cresce por gravidade: cada domínio novo entra ali porque ali\n' +
        'é onde os outros estão, e nada mede isso até ele virar um manifesto de\n' +
        '780 linhas que ninguém consegue ler inteiro.\n\n' +
        'Mova as rotas para `src/routes/<dominio>-routes.tsx`, exportando um\n' +
        'VALOR JSX (um fragmento) — nunca um componente: `<Routes>` ignora\n' +
        'qualquer elemento que não seja `<Route>` ou `Fragment`, EM SILÊNCIO, e\n' +
        'o domínio inteiro viraria 404 com a suíte verde.\n\n' +
        '`subtree-wiring.test.tsx` verifica isso perguntando ao react-router.\n',
    ).toEqual([]);
  });

  it('os subtrees existem em disco — a regra acima não passa por vacuidade', () => {
    // Se `app.tsx` ficasse sem rota nenhuma (arquivo renomeado, regex quebrada),
    // o caso acima passaria com o mapa VAZIO e não provaria nada. Esta asserção
    // é a contraparte positiva, a mesma que faltou no `dist` vazio e na âncora
    // que migra.
    const subtrees = readdirSync(join(SRC, 'routes')).filter((f) => f.endsWith('-routes.tsx'));
    expect(subtrees.length, 'nenhum subtree de rotas em src/routes/').toBeGreaterThanOrEqual(5);

    const totalNosSubtrees = subtrees
      .map((f) => readFileSync(join(SRC, 'routes', f), 'utf8'))
      .reduce((n, t) => n + [...t.matchAll(/<Route\s+path="/g)].length, 0);
    expect(totalNosSubtrees, 'os subtrees existem mas estão vazios').toBeGreaterThan(50);
  });
});
