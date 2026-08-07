import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';

const SRC = resolve(__dirname, '..');

/**
 * Guard: um modulo de producao cujo UNICO importador e o proprio teste.
 *
 * ## O defeito que isto fecha
 *
 * A auditoria de 2026-08-06 encontrou o mesmo padrao cinco vezes, sempre igual:
 * um modulo escrito, testado, verde no CI — e nunca ligado a nada. O teste passa
 * e reporta cobertura, o que e verdadeiro e irrelevante. `useDomainStatusPolling`
 * e `useFirstDeployTrigger` (B-030) sao hooks de comportamento visivel ao
 * usuario nessa situacao; doze modulos de B-031 somavam
 * 935 LOC de producao mais 844 de teste sem um consumidor real.
 *
 * O custo nao e o codigo morto em si: e que a suite verde afirma cobertura sobre
 * uma feature que producao nunca executa, e ninguem percebe ate uma auditoria.
 *
 * ## Por que quantificar em vez de listar
 *
 * Este teste quantifica sobre o EFEITO, nao sobre os catorze casos conhecidos —
 * o decimo quinto nao pode entrar em silencio. E a mesma escolha que
 * `silent-null-guard.test.ts` faz para o null silencioso, pelo mesmo motivo.
 *
 * ## A allowlist, e por que ela existe com o tamanho declarado
 *
 * Os casos atuais estao listados abaixo com o item de backlog que os cobre. Cada
 * um sai daqui quando for wired ou apagado — a decisao e caso a caso e ela NAO e
 * tecnica: `useFirstDeployTrigger` dispara confetti no primeiro deploy, o que e
 * chamada de produto, nao de engenharia. A lista nao deve crescer.
 */
const ALLOWLIST = new Set([
  // B-030 — hooks de comportamento visivel, aguardando decisao de wire-ou-apagar.
  'hooks/use-first-deploy-trigger.ts',
  // B-031 — doze modulos sem importador nao-teste. Triagem em dois baldes
  // (wire vs apagar) registrada no item; safe-redirect.ts em especial e um guard
  // de open-redirect que ninguem chama, o que e uma lacuna de seguranca latente.
  // CASCATA (2026-08-06) — apagar os 10 orfaos de B-031 revelou DOIS modulos que
  // so eram alcancados por eles. Limpeza de codigo morto e iterativa: cada camada
  // removida expoe a seguinte, e e por isso que o guard quantifica sobre o efeito
  // em vez de listar casos.
  //
  // Nenhum dos dois foi apagado junto, e por razoes diferentes:
  //
  // `lib/auth/return-to.ts` e um GUARD DE SEGURANCA (`sanitizeReturnTo`, OWASP
  // A01: XSS por javascript:/data: e open-redirect via `return_to`). Verifiquei
  // os tres usos de `return_to` no repo — todos ESCREVEM a URL com o proprio
  // origin, nenhum LE um `return_to` externo para navegar. Ou seja: nao ha vetor
  // ativo hoje, diferente do `safe-redirect.ts`, que tinha o device-verify
  // navegando cru. Apagar um guard escrito para um vetor que pode voltar e
  // decisao consciente, nao efeito colateral de uma limpeza.
  //
  // `lib/log-download.ts` exporta o download do buffer de log; sua UI era o
  // `log-viewer-toolbar.tsx` que acabou de sair. A feature nunca esteve
  // acessivel (o toolbar tambem era orfao), entao apagar e provavelmente certo —
  // mas isso e apagar uma FEATURE, e vale ser dito em voz alta.
  'lib/auth/return-to.ts',
  'lib/export/log-download.ts',
  // B-095 / B-051 — `useStatusStream` NAO e descuido: a assinatura foi removida de
  // `project-status.tsx` de proposito, porque abria um EventSource e DESCARTAVA
  // todo evento recebido — gastando uma das ~6 conexoes que o browser concede por
  // dominio, e reabrindo com o ambiente errado quando o snapshot chegava.
  //
  // O caminho de reintroducao esta escrito no lugar (`project-status.tsx:88`), e
  // os tres importadores de producao consomem so o TIPO `SignalName` — foi por
  // isso que o guard nao o via ate B-095 ensina-lo a ignorar `import type`.
  //
  // Fica aqui, e nao apagado, por uma razao concreta: e o UNICO stream que
  // autentica por COOKIE em vez de token na URL, e serve de referencia viva para
  // a correcao de B-088. Apaga-lo levaria junto o exemplo de como fazer certo.
  //
  // Sai daqui quando a SignalGrid consumir realtime, ou quando B-088 fechar.
  'hooks/projects/use-status-stream.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'mocks' || entry === 'test' || entry === 'vendor' || entry === 'build') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Todo arquivo de src/, para varrer os imports uma vez so. */
function allFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk_(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
  function walk_(d: string, acc: string[]) {
    for (const e of readdirSync(d)) {
      const f = join(d, e);
      if (statSync(f).isDirectory()) walk_(f, acc);
      else if (/\.(ts|tsx)$/.test(f)) acc.push(f);
    }
  }
}

describe('nenhum modulo de producao e importado apenas pelo proprio teste', () => {
  it('quantifica sobre o efeito — o decimo quinto caso nao entra em silencio', () => {
    const producao = walk(SRC);
    const todos = allFiles(SRC);

    // Mapa: caminho absoluto sem extensao -> quem o importa (arquivo, isTest).
    const importadores = new Map<string, { from: string; isTest: boolean }[]>();

    for (const file of todos) {
      const src = readFileSync(file, 'utf8');
      const isTest = /\.(test|spec)\.(ts|tsx)$/.test(file);
      // B-095 — `import type` NAO conta como consumidor.
      //
      // Um import de tipo desaparece na compilacao: ele nao mantem nada vivo em
      // runtime. Contar os dois igual fazia o guard declarar consumido um modulo
      // cujo codigo executavel nunca roda — e o caso real era grande:
      // `use-status-stream.ts` (250 LoC, abre EventSource) tem TRES importadores
      // de producao, e os tres fazem `import type { SignalName }`. O guard estava
      // verde sobre um modulo cujo unico `useStatusStream(` no repositorio inteiro
      // e uma LINHA COMENTADA.
      //
      // A regex ignora `import type {...} from` e `export type {...} from`. Nao
      // pega o caso misto (`import { type A, B }`), que consome B de verdade e
      // portanto DEVE contar — entao o falso-negativo remanescente e conservador,
      // que e o lado certo de errar aqui.
      const semImportDeTipo = src
        .replace(/import\s+type\s+[^;]*?from\s+['"][^'"]+['"]/g, '')
        .replace(/export\s+type\s+\{[^}]*\}\s*from\s+['"][^'"]+['"]/g, '');
      const specs = [...semImportDeTipo.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      specs.push(...[...semImportDeTipo.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]));

      for (const spec of specs) {
        let alvo: string | null = null;
        if (spec.startsWith('@/')) alvo = resolve(SRC, spec.slice(2));
        else if (spec.startsWith('.')) alvo = resolve(dirname(file), spec);
        if (!alvo) continue;
        const chave = alvo.replace(/\.(ts|tsx)$/, '');
        const lista = importadores.get(chave) ?? [];
        lista.push({ from: file, isTest });
        importadores.set(chave, lista);
      }
    }

    const ofensores: string[] = [];
    for (const mod of producao) {
      const rel = relative(SRC, mod).replace(/\\/g, '/');
      if (ALLOWLIST.has(rel)) continue;
      // `index.ts(x)` e alcancado pelo caminho do diretorio.
      const chaves = [mod.replace(/\.(ts|tsx)$/, '')];
      if (/\/index\.(ts|tsx)$/.test(mod)) chaves.push(dirname(mod));

      const refs = chaves.flatMap((k) => importadores.get(k) ?? []);
      if (refs.length === 0) continue; // sem importador algum: e outro problema (dead code), nao este
      if (refs.some((r) => !r.isTest)) continue; // tem consumidor real

      ofensores.push(`${rel} — importado apenas por: ${refs.map((r) => relative(SRC, r.from)).join(', ')}`);
    }

    expect(
      ofensores,
      'Modulo(s) de producao cujo unico importador e um teste. Um teste verde sobre codigo que\n' +
        'producao nunca executa reporta cobertura verdadeira e irrelevante. Decida por modulo:\n' +
        'ligue-o a um consumidor real, ou apague-o com o teste. Se a decisao depender do produto,\n' +
        'registre no BACKLOG e adicione a ALLOWLIST deste arquivo com o item que a cobre.\n',
    ).toEqual([]);
  });
});
