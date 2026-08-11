import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { arquivosDoManifestoDeRotas } from '@/test/manifesto-de-rotas';

const APP = readFileSync(resolve(__dirname, '../app.tsx'), 'utf8');
/**
 * B-003 — os subtrees de domínio saíram para `src/routes/`, e TODOS eles vivem
 * dentro do `<DashboardLayout>`. Ler só o `app.tsx` para contar rotas
 * autenticadas passou a medir o resto de um arquivo que já não as tem.
 */
const AUTENTICADAS = arquivosDoManifestoDeRotas().slice(1).join('\n');

/**
 * B-003 — a fronteira entre rota pública e rota autenticada.
 *
 * ## Por que esta rede existe antes do próximo corte
 *
 * `app.tsx` tem 592 linhas e 119 rotas. A próxima fatia da decomposição mexe em
 * **aninhamento e guarda** — e a rede que existe (`app.test.tsx`, 7 casos) cobre
 * apenas redirects e aliases. Nenhum caso cobre a fronteira.
 *
 * O modo de falha é silencioso nos dois sentidos:
 *
 * - Uma rota **pública** que caia para dentro de `<DashboardLayout>` passa a
 *   exigir login. `/recovery` atrás de autenticação é uma armadilha perfeita:
 *   quem perdeu a senha não consegue entrar para recuperá-la.
 * - Uma rota **autenticada** que suba para fora do layout deixa de exigir login,
 *   e o dado do tenant fica atrás de uma tela que renderiza sem sessão.
 *
 * Nenhum dos dois quebra teste hoje. Um refactor que reordene blocos passaria.
 *
 * ## O que este teste NÃO faz
 *
 * Não verifica o comportamento em runtime — para isso existem os testes de
 * página e o `useRequireAuth`. Ele verifica a ESTRUTURA do arquivo, que é o que
 * um refactor de decomposição move.
 */

/** A âncora que separa as duas metades da árvore. */
const ANCORA = '<DashboardLayout>';

function rotasAntesDaAncora(): string[] {
  const corte = APP.indexOf(ANCORA);
  if (corte === -1) throw new Error('`<DashboardLayout>` não encontrado — a árvore mudou de forma');
  return [...APP.slice(0, corte).matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
}

function rotasDepoisDaAncora(): string[] {
  const corte = APP.indexOf(ANCORA);
  return [
    ...[...APP.slice(corte).matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]),
    ...[...AUTENTICADAS.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]),
  ];
}

/**
 * As rotas que DEVEM ficar fora da autenticação.
 *
 * Cada uma existe para alguém que ainda não tem sessão — ou que a perdeu. Pôr
 * qualquer uma atrás do login cria um beco: a pessoa precisa da tela para
 * conseguir entrar, e precisa entrar para alcançar a tela.
 */
const PUBLICAS = [
  '/login',
  '/register',
  '/signup',
  '/registration',
  '/verification',
  '/auth/check-email',
  '/auth/verify',
  '/recovery',
  '/device-success',
  '/device-verify',
] as const;

describe('fronteira público/autenticado (B-003)', () => {
  it('toda rota de autenticação está FORA do layout autenticado', () => {
    const publicas = new Set(rotasAntesDaAncora());
    const presas = PUBLICAS.filter((r) => !publicas.has(r));

    expect(
      presas,
      'Rota de autenticação dentro do layout autenticado.\n\n' +
        'Ela passa a exigir login — e essas telas existem justamente para quem\n' +
        'ainda não tem sessão, ou perdeu a dela. `/recovery` atrás do login é um\n' +
        'beco perfeito: a pessoa precisa da tela para conseguir entrar, e precisa\n' +
        'entrar para alcançar a tela.\n\n' +
        'Ao reorganizar as rotas, mantenha estas ANTES do `<DashboardLayout>`.\n',
    ).toEqual([]);
  });

  it('nenhuma rota autenticada escapou para fora do layout', () => {
    const foraDoLayout = rotasAntesDaAncora().filter(
      (r) => !PUBLICAS.includes(r as (typeof PUBLICAS)[number]) && r !== '*',
    );

    expect(
      foraDoLayout,
      'Rota fora do layout autenticado que não é de autenticação.\n\n' +
        'Ela deixa de exigir login, e o dado do tenant passa a ficar atrás de uma\n' +
        'tela que renderiza sem sessão. É o mesmo defeito da linha acima, no\n' +
        'sentido oposto — e igualmente silencioso.\n\n' +
        'Se a rota é mesmo pública, acrescente-a a PUBLICAS com o motivo.\n',
    ).toEqual([]);
  });

  it('a maioria das rotas está DENTRO do layout — a âncora não se moveu', () => {
    // Se a âncora migrasse para o topo do arquivo, as duas asserções acima
    // passariam sobre conjuntos quase vazios e não provariam nada. É a mesma
    // armadilha do `dist` vazio: um teste que afirma ausência precisa provar
    // que olhou para algum lugar.
    expect(rotasDepoisDaAncora().length).toBeGreaterThan(50);
  });

  it('toda rota passa por RouteBoundary — um crash não derruba a moldura', () => {
    // `Boundaried` isola o crash na página: a barra lateral e a superior
    // sobrevivem, e o relatório de erro sai classificado por rota. Uma rota que
    // escape disso troca "esta página falhou" por uma tela branca.
    const rotas = [...(APP + '\n' + AUTENTICADAS).matchAll(/<Route\s+path="([^"]+)"[\s\S]{0,400}?\/>/g)];
    const semGuarda = rotas
      .filter(([bloco, caminho]) => {
        if (bloco.includes('Boundaried')) return false;
        // Rota ANINHADA herda a fronteira do pai. Elas se distinguem por não
        // começarem com `/` — `path="logs"` dentro de
        // `/projects/:name/deployments/:id`, cujo elemento já tem `Boundaried`.
        //
        // A primeira versão as acusava, e "consertar" significaria envolver
        // cada aba numa segunda fronteira dentro de uma que já existe: mais
        // código para capturar um erro que o pai já captura.
        if (!caminho.startsWith('/')) return false;
        // Redirects não renderizam página, então não precisam de fronteira de
        // erro. Eles aparecem em duas formas, e a primeira versão deste teste
        // só via a primeira: `<Navigate>` inline, e um COMPONENTE que devolve
        // `<Navigate>` (`PreviewsRedirect`, `RepositoryAlias` — existem porque
        // precisam ler `useParams` para montar o destino).
        //
        // Casar só o inline acusava os dois componentes como desprotegidos —
        // um falso positivo que empurraria alguém a "consertar" envolvendo um
        // redirect numa fronteira de erro que ele nunca vai usar.
        return !/Navigate|Redirect|Alias/.test(bloco);
      })
      .map((m) => m[1]);

    expect(
      semGuarda,
      'Rota sem `Boundaried`.\n\n' +
        'Um crash nessa página derruba a moldura inteira em vez de renderizar o\n' +
        'fallback da rota — e o relatório de erro perde a classificação por\n' +
        'caminho, que é o que diz QUAL tela quebrou.\n\n' +
        'Redirects (`<Navigate>`) não precisam: eles não renderizam página.\n',
    ).toEqual([]);
  });
});
