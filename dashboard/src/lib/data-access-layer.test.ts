import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const PAGES = resolve(__dirname, '../pages');
const SRC = resolve(__dirname, '..');

/**
 * B-012 / B-029 / B-052 / B-053 — quantas páginas ainda falam HTTP direto.
 *
 * ## O que isto mede
 *
 * Um arquivo sob `src/pages/**` que importa `cloudFetch` ou `engineFetch` está
 * fazendo acesso a dados na camada de interface: ele monta o request, escolhe a
 * query key e decide a política de cache, tudo dentro da tela. O resultado é que
 * o mesmo endpoint é lido de formas diferentes em telas diferentes — foi assim
 * que `query-key-convergence.test.ts` precisou existir.
 *
 * O `ADR-0006` decidiu a camada por domínio em 2026-08-06 e nunca foi executado.
 * O plano `dashboard-data-access-layer-plan.md` é a execução, e este é o número
 * que ele move.
 *
 * ## Por que um teto e não zero
 *
 * Afirmar zero exigiria migrar os 64 num plano só, o que não cabe numa métrica
 * (Regra de Qualidade 0 do `/to-plan`). Um teto que **só desce** dá rede contra
 * regressão desde o primeiro dia e deixa a migração acontecer em planos
 * sucessivos — que é o mesmo formato de `adr-nomenclature.test.ts` e
 * `sse-token-in-url.test.ts`, já em uso aqui.
 *
 * Sem ele, os arquivos restantes crescem livremente durante os planos seguintes.
 * Foi assim que se chegou a 64.
 *
 * ## O que ele NÃO prova
 *
 * Que a camada existe. Ele prova que ela não encolheu. Um domínio migrado com
 * hook errado — query key literal, sem invalidação — baixa este número e não
 * melhora nada; quem cobre isso é `query-key-convergence.test.ts`.
 */

/**
 * Medido em 2026-08-07 sobre `549d198b`. **SÓ DESCE.**

O plano dizia 64. Estava errado: aquele número veio de `grep -rl` sobre o
arquivo inteiro, que casa comentário. Sete dos 64 apenas MENCIONAM transporte —
quatro deles para dizer que pararam de usar, e um injeta `cloudFetch` como
dependência, que é o padrão certo. O número real é 58, e a diferença é
exatamente a classe "grep casa prosa".
 *
 * Baixar este número num commit mantém o teste verde — é a direção certa. Subir
 * exige explicar por quê, e o plano diz que não há razão: uma página nova busca
 * dado pelo hook do domínio.
 */
const TETO_PAGINAS_COM_TRANSPORTE = 58;

/** Os identificadores que caracterizam transporte. `ApiError` NÃO é um deles. */
const TRANSPORTE = ['cloudFetch', 'engineFetch', 'cloudFetchRaw'];

function arquivos(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) arquivos(full, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

/**
 * Casa o BLOCO importado, não o caminho do módulo.
 *
 * A distinção é o que faz o número medir a coisa certa: `import { ApiError } from
 * '@/lib/http/api'` é uma página tratando erro tipado, o que é correto e deve
 * continuar. Contar por caminho do módulo somaria esses arquivos e o teto
 * mediria "quem conhece o módulo de HTTP" em vez de "quem faz request".
 */
function importaTransporte(src: string): boolean {
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'@\/lib\/http\/api'/g)) {
    const nomes = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim());
    if (nomes.some((n) => TRANSPORTE.includes(n))) return true;
  }
  return false;
}

export function paginasComTransporte(): string[] {
  return arquivos(PAGES)
    .filter((f) => importaTransporte(readFileSync(f, 'utf8')))
    .map((f) => relative(SRC, f).replace(/\\/g, '/'))
    .sort();
}

/**
 * Os três domínios que já têm arquivo de transporte por domínio, sem query key.
 * `promptly` tem UMA chave local (`CATALOG_QUERY_KEY`), o que não muda a
 * classificação: 20 exports e uma chave é transporte com exceção, não camada.
 */
const DOMINIOS_COM_API_PARCIAL = ['trust', 'skills', 'promptly'];

/**
 * A métrica DESTE plano, e ela é diferente da de cima — a distinção custou uma
 * versão inteira do plano para aparecer.
 *
 * As 19 páginas dos três domínios NÃO importam transporte: elas importam o
 * `*-api.ts`, e é ele que importa. Então migrá-las move `TETO_PAGINAS_COM_TRANSPORTE`
 * em ZERO. A v1.0 do plano usava aquele número como Goal e teria chegado à
 * última fase com todo o trabalho feito e a métrica intacta.
 *
 * O que o trabalho de fato move é isto: quantas páginas consomem um `*-api.ts`
 * e ainda montam o `useQuery` à mão. Zerar é o que significa "a camada existe".
 */
const TETO_PAGINAS_COM_QUERY_MANUAL = 0;

export function paginasComQueryManual(): string[] {
  const fora: string[] = [];
  for (const f of arquivos(PAGES)) {
    const src = readFileSync(f, 'utf8');
    const usaApiParcial = DOMINIOS_COM_API_PARCIAL.some((d) =>
      new RegExp(`from\\s*'[^']*${d}-api'`).test(src),
    );
    // O sinal é a página CONHECER UMA QUERY KEY. São dois verbos, e a escolha
    // deles foi corrigida duas vezes por medição.
    //
    // `useQueryClient` ENTROU: `trust/guardrail-new.tsx:52` não montava
    // `useQuery`, ele invalidava à mão — e invalidar exige conhecer a chave, que
    // é exatamente o defeito. Contar só `useQuery` deixaria de fora a página que
    // faz a pior metade do trabalho.
    //
    // `useMutation` SAIU. Ele estava aqui por simetria e não por medição: uma
    // mutation NÃO precisa conhecer chave nenhuma. Depois de migrar skills, as
    // quatro páginas que ainda contavam tinham `useQueryClient=0` e
    // `queryKey:=0` — o defeito havia saído inteiro delas, e o número não descia
    // porque o sinal media o verbo errado. Uma `useMutation` cujo `onSuccess`
    // chama `invalidarSkills()` delega o cache; é o oposto de gerenciá-lo à mão.
    //
    // A fronteira de palavra também é medida: `'useQuery' in src` casa
    // `useQueryClient` por substring, e foi assim que a contagem deu 19 pelo
    // motivo errado antes de dar 19 pelo certo.
    if (usaApiParcial && /\buseQuery\b|\buseQueryClient\b/.test(src)) {
      fora.push(relative(SRC, f).replace(/\\/g, '/'));
    }
  }
  return fora.sort();
}

describe('camada de acesso a dados (B-012/B-029/B-052/B-053)', () => {
  it('nenhuma página monta o useQuery à mão sobre um *-api.ts', () => {
    const ofensores = paginasComQueryManual();

    expect(
      ofensores.length,
      `${ofensores.length} páginas consomem um *-api.ts e montam o useQuery à mão; o teto é ${TETO_PAGINAS_COM_QUERY_MANUAL}.\n\n` +
        'Um `*-api.ts` exporta transporte e (quase) nenhuma query key, então cada\n' +
        'página que o consome reescreve a chave, o staleTime e a invalidação. O mesmo\n' +
        'endpoint acaba com identidades de cache diferentes em telas diferentes.\n\n' +
        'Vale para `useQueryClient` sozinho: invalidar à mão exige conhecer a chave,\n' +
        'que é a metade do defeito que mais cala quando erra.\n\n' +
        'Busque por um hook de domínio em `src/hooks/<dominio>/`, com a chave vinda\n' +
        'de `queryKeys` (ADR-0006). `src/hooks/projects/use-projects.ts` é a forma\n' +
        'canônica; o `*-api.ts` permanece como camada de transporte sob o hook.\n',
    ).toBeLessThanOrEqual(TETO_PAGINAS_COM_QUERY_MANUAL);
  });

  it('o número de páginas que falam HTTP direto só desce', () => {
    const ofensores = paginasComTransporte();

    expect(
      ofensores.length,
      `${ofensores.length} arquivos de src/pages importam transporte; o teto é ${TETO_PAGINAS_COM_TRANSPORTE}.\n\n` +
        'Uma página que importa `cloudFetch`/`engineFetch` monta o request, escolhe a\n' +
        'query key e decide a política de cache dentro da tela. O mesmo endpoint acaba\n' +
        'lido de formas diferentes em telas diferentes — foi por isso que\n' +
        '`query-key-convergence.test.ts` precisou existir.\n\n' +
        'Busque o dado por um hook de domínio em `src/hooks/<dominio>/`, com a chave\n' +
        'vinda de `queryKeys` (ADR-0006). `src/hooks/projects/use-projects.ts` é a\n' +
        'forma canônica.\n\n' +
        'Este teto SÓ DESCE. Se você precisa subi-lo, o plano\n' +
        '`dashboard-data-access-layer-plan.md` diz que não há razão.\n',
    ).toBeLessThanOrEqual(TETO_PAGINAS_COM_TRANSPORTE);
  });

  it('importar apenas `ApiError` NÃO conta como acesso a dados', () => {
    // Uma página que trata erro tipado está fazendo a coisa certa (`rules/
    // error-handling.md` § 2: erros explícitos e tipados). Se o guard contasse
    // por caminho do módulo, ele mediria "quem conhece o módulo de HTTP" em vez
    // de "quem faz request" — e puniria justamente o tratamento correto.
    expect(importaTransporte("import { ApiError } from '@/lib/http/api';")).toBe(false);
    expect(importaTransporte("import type { CloudFetchConfig } from '@/lib/http/api';")).toBe(false);
  });

  it('reconhece transporte em qualquer posição do bloco e sob alias', () => {
    expect(importaTransporte("import { ApiError, cloudFetch } from '@/lib/http/api';")).toBe(true);
    expect(importaTransporte("import { engineFetch } from '@/lib/http/api';")).toBe(true);
    // O alias é o caminho mais curto para escapar de um guard que casa texto
    // cru — aqui ele não escapa, porque a comparação é sobre o nome ORIGINAL.
    expect(importaTransporte("import { cloudFetch as buscar } from '@/lib/http/api';")).toBe(true);
  });
});
