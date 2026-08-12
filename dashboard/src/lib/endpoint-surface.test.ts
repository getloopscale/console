// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

/**
 * B-113 — o mesmo recurso, alcançado por dois endereços.
 *
 * ## O defeito, medido
 *
 * A lista de projetos é lida por DOIS caminhos, sob DUAS chaves de cache que não se falam:
 *
 *     hooks/projects/use-projects.ts       ['projects','list',{limit}]   /engine/api/v1/projects
 *     add-domain-sheet.tsx                 ['engine','/api/v1/projects'] /api/v1/projects
 *     create-environment-sheet.tsx         ['engine','/api/v1/projects'] /api/v1/projects
 *
 * E `use-bulk-delete-projects.ts:52` invalida `queryKeys.projects.all` — que é `['projects']`, e
 * não alcança `['engine', …]`. Com `staleTime: 60_000`, apagar um projeto e abrir "Add domain"
 * dentro de um minuto oferece o projeto apagado no seletor, e o usuário pode apontar um domínio
 * para ele.
 *
 * O `promote` tem a mesma forma: `use-promote.ts` chama `/engine/api/v1/…/promote` e
 * `use-environments.ts` chama `/api/v1/…/promote`. A mesma operação de negócio, dois endereços,
 * duas invalidações diferentes.
 *
 * ## Por que um guard, e não três consertos
 *
 * Consertar os três casos não impede o quarto — e o quarto entra do mesmo jeito que estes:
 * alguém precisa da lista de projetos numa tela nova, encontra `useEngineApi` primeiro, e o
 * endereço que ele escolhe é o que estiver mais à mão. Nada no repositório diz qual é o canônico.
 *
 * Este arquivo diz. Ele varre o código de produção e reprova quando um recurso da engine é
 * endereçado pelos dois prefixos ao mesmo tempo.
 *
 * ## O que ele NÃO prova
 *
 * Que o backend deveria expor um só. Essa é a pergunta do `B-114`, e ela é do outro lado da
 * fronteira. Daqui, o que dá para garantir é que o CLIENTE escolhe um.
 */

const PULAR = new Set(['node_modules', 'dist', 'coverage', '.git', 'mocks', 'test']);

function arquivosDeProducao(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (PULAR.has(nome)) continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      arquivosDeProducao(caminho, saida);
      continue;
    }
    if (!/\.tsx?$/.test(nome)) continue;
    if (/\.(test|spec)\.tsx?$/.test(nome)) continue;
    saida.push(caminho);
  }
  return saida;
}

/**
 * Remove comentários antes de casar.
 *
 * Sem isto o guard acusava `main.tsx`, `logout-cache-purge.ts` e `session.ts` — três arquivos que
 * CITAM os caminhos em prosa para explicar um defeito antigo, e não chamam nenhum deles. Um guard
 * que reprova comentário ensina a apagar a explicação, que é o oposto do que este repositório
 * quer; e o primeiro que for acusado injustamente é o que faz alguém desligar a varredura.
 *
 * A remoção é ingênua de propósito: uma `//` dentro de uma string vira corte. O erro que isso
 * causa é FALSO NEGATIVO (deixa de ver uma chamada), nunca falso positivo — a direção certa para
 * um guard errar.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/.*$/gm, (linha) => {
    const i = linha.indexOf('//');
    return linha.slice(0, i);
  });
}

/**
 * O recurso alcançado por um caminho da engine.
 *
 * `/engine/api/v1/projects/{name}/promote` e `/api/v1/projects/{name}/promote` são o MESMO
 * recurso por dois prefixos — é isso que o teste precisa ver. Os segmentos interpolados viram
 * `{}` para que `${encodeURIComponent(name)}` e `{name}` sejam a mesma coisa.
 */
function recursosDe(fonte: string): Map<string, 'engine' | 'direto'> {
  const achados = new Map<string, 'engine' | 'direto'>();
  for (const m of semComentarios(fonte).matchAll(/['"`](\/(?:engine\/)?api\/v1\/[^'"`\s]*)/g)) {
    const bruto = m[1];
    const viaEngine = bruto.startsWith('/engine/');
    const semPrefixo = bruto.replace(/^\/engine/, '');
    const canonico = semPrefixo
      .split('?')[0]
      .replace(/\$\{[^}]*\}/g, '{}') // interpolação → placeholder
      .replace(/\/\{[^}]*\}/g, '/{}') // {name} literal → placeholder
      .replace(/\/$/, '');
    if (canonico === '/api/v1') continue;
    achados.set(canonico, viaEngine ? 'engine' : 'direto');
  }
  return achados;
}

describe('um recurso, um endereço (B-113)', () => {
  it('nenhum recurso da engine é endereçado pelos DOIS prefixos', () => {
    const porRecurso = new Map<string, { engine: string[]; direto: string[] }>();

    for (const arquivo of arquivosDeProducao(SRC)) {
      const rel = relative(SRC, arquivo);
      for (const [recurso, via] of recursosDe(readFileSync(arquivo, 'utf8'))) {
        const entrada = porRecurso.get(recurso) ?? { engine: [], direto: [] };
        entrada[via].push(rel);
        porRecurso.set(recurso, entrada);
      }
    }

    const ambiguos = [...porRecurso.entries()]
      .filter(([, v]) => v.engine.length > 0 && v.direto.length > 0)
      .map(([recurso, v]) => `${recurso}\n      engine: ${v.engine.join(', ')}\n      direto: ${v.direto.join(', ')}`);

    expect(
      ambiguos,
      'Recurso alcançado pelos DOIS prefixos.\n\n' +
        'Dois endereços para o mesmo dado são duas chaves de cache que não se invalidam.\n' +
        'Foi assim que apagar um projeto deixou de sumir do seletor de "Add domain": a\n' +
        'invalidação alcança `[\'projects\']` e a folha lê por `[\'engine\', \'/api/v1/projects\']`.\n\n' +
        'Escolha UM. O canônico é o que o hook de domínio já usa — leia por ele em vez de\n' +
        'abrir um segundo caminho para o mesmo recurso.\n',
    ).toEqual([]);
  });
});
