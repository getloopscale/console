import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';

const SRC = resolve(__dirname, '..');

/**
 * ADR-0001 D5 item 2 — a regra de residência, medida.
 *
 * ## O que esta suíte protege
 *
 * O ADR decide que `src/components/`, `src/hooks/` e as pastas de contexto de
 * `src/lib/` só aceitam artefato com **2+ domínios consumidores**. Sem uma
 * medição, isso é acordo verbal: a árvore atual foi produzida exatamente assim,
 * um arquivo por vez, cada um plausível isoladamente.
 *
 * A versão anterior do ADR chamava a regra de "contável, e é isso que a torna
 * verificável em vez de opinativa" — e a unidade contada (`src/features/`) não
 * existia. Este arquivo é o que fecha essa lacuna: a contagem acontece.
 *
 * ## Por que quantifica sobre o efeito
 *
 * Assim como `test-only-module-guard.test.ts`, ele não lista os casos conhecidos.
 * O caso seguinte não pode entrar em silêncio — que é o modo como esta dívida
 * nasceu.
 *
 * ## O que ele NÃO prova
 *
 * O grafo é montado por regex sobre `from '...'`, então `import()` dinâmico com
 * expressão computada escapa. E "domínio" aqui é o diretório, não a semântica:
 * dois arquivos no mesmo domínio contam como um consumidor mesmo que sirvam a
 * telas sem relação. É a definição de D4, e ela é deliberadamente grosseira —
 * uma regra que exige julgamento não é executável.
 */
const DOMINIOS = new Set([
  'auth', 'projects', 'deploy', 'infra', 'settings', 'overview',
  'lens', 'memory', 'promptly', 'rag', 'skills', 'trust', 'workspace',
]);

/** Nome de pasta que não é domínio, e para qual domínio ela conta. */
const NORMALIZA: Record<string, string> = {
  billing: 'settings', register: 'auth', project: 'projects', readiness: 'projects',
  'deployment-tabs': 'deploy', login: 'auth', verification: 'auth', domains: 'infra',
  environments: 'infra', secrets: 'infra', team: 'settings', scale: 'projects', logs: 'deploy',
};

/**
 * Pastas compartilhadas cujo conteúdo a regra governa. `components/ui` e
 * `components/layout` estão de fora de propósito: são a fronteira do design
 * system e o shell da aplicação, consumidos por composição e não por domínio.
 */
const GOVERNADAS = ['components', 'hooks', 'lib/http', 'lib/telemetry', 'lib/formatting', 'lib/export'];

/**
 * `hooks/<dominio>/` JA E o diretorio do dominio — na camada hooks, que e onde
 * D4.1 manda um hook de dominio morar. Governar essas subpastas faria a regra
 * exigir que eles descessem para `pages/<d>/`, que e exatamente a violacao de
 * camada que D4.1 existe para impedir. O mesmo vale para `hooks/mutations/`,
 * que e uma categoria e nao um dominio.
 */
function jaResidente(rel: string): boolean {
  return /^hooks\/[a-z-]+\//.test(rel);
}

const ALLOWLIST = new Set<string>([
  // Consumidos pela barra lateral (components/layout), que é cross-cutting mas
  // não é "domínio" — a contagem por domínio não os enxerga. Ver ADR-0001 D4.1.
  'components/layout/lens-capabilities.ts',
  'components/layout/team-switcher.tsx',
  // Consumidos por `main.tsx` (a raiz de composicao) e por `lib/http/api.ts` —
  // nenhum dos dois e "dominio", entao a contagem nao os enxerga. Descer estes
  // dois para `pages/auth/` faria a raiz da aplicacao e a camada lib importarem
  // de pages/, que e a violacao de direcao que D4.1 descreve.
  'lib/http/config.ts',
  'lib/telemetry/rum.ts',
]);

function arquivos(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) arquivos(full, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec|stories)\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

function dominioDe(file: string): string | null {
  const partes = relative(SRC, file).split('/');
  if (!['pages', 'components', 'hooks'].includes(partes[0])) return null;
  if (partes.length < 2) return null;
  const bruto = partes[1].replace(/\.(ts|tsx)$/, '');
  const d = NORMALIZA[bruto] ?? bruto;
  return DOMINIOS.has(d) ? d : null;
}

describe('regra de residência (ADR-0001 D3/D5)', () => {
  it('nada em pasta compartilhada tem menos de 2 domínios consumidores', () => {
    const todos = arquivos(SRC);
    const consumidores = new Map<string, Set<string>>();

    for (const f of todos.concat(
      // testes contam como consumidor? NÃO — um módulo consumido só por teste é
      // outro defeito, coberto por test-only-module-guard. Aqui interessa
      // produção.
      [],
    )) {
      const src = readFileSync(f, 'utf8');
      const specs = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      specs.push(...[...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]));
      const dom = dominioDe(f);
      if (!dom) continue;

      for (const spec of specs) {
        let alvo: string | null = null;
        if (spec.startsWith('@/')) alvo = resolve(SRC, spec.slice(2));
        else if (spec.startsWith('.')) alvo = resolve(dirname(f), spec);
        if (!alvo) continue;
        const chave = alvo.replace(/\.(ts|tsx)$/, '');
        const set = consumidores.get(chave) ?? new Set<string>();
        set.add(dom);
        consumidores.set(chave, set);
      }
    }

    const ofensores: string[] = [];
    for (const pasta of GOVERNADAS) {
      const base = join(SRC, pasta);
      let mods: string[];
      try {
        mods = arquivos(base);
      } catch {
        continue; // pasta ainda não existe
      }
      for (const m of mods) {
        const rel = relative(SRC, m).replace(/\\/g, '/');
        if (ALLOWLIST.has(rel)) continue;
        // ui/ e layout/ são a fronteira do design system e o shell — fora da regra.
        if (/^components\/(ui|layout)\//.test(rel)) continue;
        if (jaResidente(rel)) continue;
        const doms = consumidores.get(m.replace(/\.(ts|tsx)$/, '')) ?? new Set();
        if (doms.size === 1) {
          ofensores.push(`${rel} — consumido só por: ${[...doms][0]}`);
        }
      }
    }

    expect(
      ofensores,
      'Artefato em pasta COMPARTILHADA com um único domínio consumidor.\n' +
        'ADR-0001 D3: ele mora no diretório desse domínio, não aqui.\n\n' +
        'Antes de mover, leia D4.1: se algum consumidor estiver numa camada ABAIXO\n' +
        'de pages/, o destino é a camada mais baixa entre as que o consomem — mover\n' +
        'para pages/<dominio>/ criaria uma violação de direção de camada.\n\n' +
        'Se o artefato for genuinamente cross-cutting e a contagem por domínio não\n' +
        'o enxergar, acrescente à ALLOWLIST deste arquivo COM o motivo.\n',
    ).toEqual([]);
  });
});
