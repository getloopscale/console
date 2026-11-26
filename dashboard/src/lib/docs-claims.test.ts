// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * O guarda das afirmações medidas da documentação (B-158..B-212).
 *
 * ## Por que a lógica mora AQUI e não num módulo ao lado
 *
 * Foi extraída para `lib/docs-claims.ts` primeiro, e `test-only-module-guard` reprovou: um módulo
 * de produção cujo único importador é o próprio teste é código que produção nunca executa, e um
 * teste verde sobre ele reporta cobertura verdadeira e irrelevante.
 *
 * O guarda está certo, e os três irmãos deste arquivo já sabiam disso — `loc-budget-ratchet`,
 * `absence-assertion-ratchet` e `adr-nomenclature` carregam a própria medição dentro do teste,
 * pela mesma razão. Este segue a convenção em vez de pedir uma dispensa para si mesmo.
 */


/**
 * As afirmações MEDIDAS que a documentação faz, e como re-medi-las (B-158..B-212).
 *
 * ## Por que este módulo existe
 *
 * Catorze itens do backlog dizem a mesma coisa em catorze lugares: um documento afirma um fato
 * medido — uma contagem, um teto, um caminho — e o código andou. Corrigir os catorze à mão
 * reinicia o mesmo relógio.
 *
 * Isso não é especulação. A varredura de 2026-08-11 registrou `app.tsx` com 226 linhas e 434
 * arquivos `.tsx`; quatro horas depois, após duas fatias sem relação, os mesmos comandos devolvem
 * 231 e 437. **Dois dos números que este módulo existe para corrigir derivaram enquanto o plano
 * era escrito.**
 *
 * ## A forma
 *
 * Uma TABELA declarativa. Cada linha diz onde a afirmação vive, como extraí-la e como medir a
 * verdade. Acrescentar a décima quinta afirmação é acrescentar uma linha, não escrever um teste
 * (OCP). É o mesmo instrumento que `loc-budget-ratchet`, `absence-assertion-ratchet` e
 * `adr-nomenclature` já aplicam a fatos de código — a prosa era a única parte do repositório sem
 * um.
 */

const DASHBOARD_ROOT = resolve(__dirname, '../..');

/** Uma afirmação numérica: onde ela está escrita, como lê-la, e como conferi-la contra o disco. */
interface AfirmacaoNumerica {
  /** Caminho do documento, relativo à raiz do dashboard. */
  readonly doc: string;
  /** O que a afirmação diz, em uma linha — aparece na mensagem de falha. */
  readonly sobre: string;
  /**
   * Captura o número afirmado. DEVE ter exatamente um grupo de captura.
   *
   * Se o padrão não casar, isso também é uma falha: significa que alguém reescreveu a frase e a
   * afirmação deixou de ser conferida sem que nada acusasse — que é o estado de onde viemos.
   */
  readonly padrao: RegExp;
  /** Mede a verdade agora, a partir do disco. */
  readonly medir: () => number;
}

function ler(rel: string): string {
  return readFileSync(join(DASHBOARD_ROOT, rel), 'utf-8');
}

/** Todos os arquivos sob `dir` que satisfazem `aceita`, recursivamente. */
function varrer(dir: string, aceita: (caminho: string) => boolean): string[] {
  const base = join(DASHBOARD_ROOT, dir);
  if (!existsSync(base)) return [];
  const achados: string[] = [];
  const pilha = [base];
  while (pilha.length > 0) {
    const atual = pilha.pop();
    if (atual === undefined) break;
    for (const nome of readdirSync(atual)) {
      if (nome === 'node_modules' || nome === 'dist' || nome.startsWith('.')) continue;
      const caminho = join(atual, nome);
      if (statSync(caminho).isDirectory()) pilha.push(caminho);
      else if (aceita(caminho)) achados.push(caminho);
    }
  }
  return achados;
}

function contarArquivosImportando(especificador: string): number {
  const fontes = varrer('src', (f) => /\.(ts|tsx)$/.test(f));
  return fontes.filter((f) => readFileSync(f, 'utf-8').includes(`from '${especificador}'`)).length;
}

function contarSubpastas(dir: string): number {
  const base = join(DASHBOARD_ROOT, dir);
  let n = 0;
  const pilha = [base];
  while (pilha.length > 0) {
    const atual = pilha.pop();
    if (atual === undefined) break;
    for (const nome of readdirSync(atual)) {
      const caminho = join(atual, nome);
      if (statSync(caminho).isDirectory()) { n += 1; pilha.push(caminho); }
    }
  }
  return n;
}

function contarADRs(status: string): number {
  return varrer('docs/adr', (f) => /\/\d{4}-.*\.md$/.test(f))
    .filter((f) => readFileSync(f, 'utf-8').includes(`status: ${status}`)).length;
}

/**
 * A tabela. Uma linha por afirmação medida que um documento faz.
 *
 * Deliberadamente NÃO cobre prosa qualitativa ("esta camada é estável") — só o que tem um número
 * conferível. Uma afirmação que ninguém consegue medir não pertence a este guarda; pertence a uma
 * revisão humana, e fingir o contrário seria teatro.
 */
const AFIRMACOES: readonly AfirmacaoNumerica[] = [
  {
    doc: 'docs/architecture.md',
    sobre: 'how many subfolders exist under src/components/ (B-159)',
    padrao: /nas \*\*(\d+)\*\* subpastas de `src\/components\/`/,
    medir: () => contarSubpastas('src/components'),
  },
  {
    doc: 'DESIGN.md',
    sobre: 'how many files import @getloopscale/ui (B-208)',
    padrao: /\| `@getloopscale\/ui` \| `[\d.]+` \| components \| (\d+) files import it \|/,
    medir: () => contarArquivosImportando('@getloopscale/ui'),
  },
  {
    doc: 'DESIGN.md',
    sobre: 'how many files import @getloopscale/loopzero-ui (B-208)',
    padrao: /\| `@getloopscale\/loopzero-ui` \| `[\d.]+` \| [^|]*\| (\d+) files/,
    medir: () => contarArquivosImportando('@getloopscale/loopzero-ui'),
  },
  {
    doc: 'docs/architecture.md',
    sobre: 'how many ADRs await acceptance (B-200)',
    padrao: /(\d+) ADRs? em `status: proposed`/,
    medir: () => contarADRs('proposed'),
  },
  {
    doc: 'docs/adr/0002-orcamento-de-loc-por-arquivo.md',
    sobre: 'how many files are in the max-lines allowlist (B-212)',
    padrao: /allowlist explicita dos (\d+) arquivos/,
    medir: () => (ler('eslint.config.js').match(/\/\/ \d+ LOC$/gm) ?? []).length,
  },
  {
    doc: 'docs/architecture.md',
    sobre: 'how many files are in the max-lines allowlist (B-212)',
    padrao: /allowlist de (\d+) arquivos/,
    medir: () => (ler('eslint.config.js').match(/\/\/ \d+ LOC$/gm) ?? []).length,
  },
  {
    doc: 'eslint.config.js',
    sobre: "how many files the rule's own prose says it locks (B-212)",
    padrao: /Os (\d+) arquivos/,
    medir: () => (ler('eslint.config.js').match(/\/\/ \d+ LOC$/gm) ?? []).length,
  },
];

interface Divergencia {
  readonly doc: string;
  readonly sobre: string;
  readonly afirmado: number | null;
  readonly medido: number;
}

/**
 * Confere toda a tabela. Devolve as divergências e QUANTAS afirmações foram conferidas.
 *
 * A contagem faz parte do retorno de propósito: uma tabela que silenciosamente casasse zero linhas
 * passaria verde provando nada — a mesma forma inerte que B-152/B-189 nomeiam, um nível acima.
 */
function conferirAfirmacoes(
  lista: readonly AfirmacaoNumerica[] = AFIRMACOES,
): { divergencias: Divergencia[]; conferidas: number } {
  const divergencias: Divergencia[] = [];
  for (const a of lista) {
    const m = a.padrao.exec(ler(a.doc));
    const medido = a.medir();
    // `null` = a frase mudou e a afirmação deixou de ser conferida. Isso É a falha, não um pulo.
    const afirmado = m === null ? null : Number(m[1]);
    if (afirmado !== medido) divergencias.push({ doc: a.doc, sobre: a.sobre, afirmado, medido });
  }
  return { divergencias, conferidas: lista.length };
}

// ---------------------------------------------------------------------------------------------
// Caminhos citados na prosa (B-201, B-207, B-209, B-210).
//
// Quatro itens sao o MESMO defeito em forma de caminho: um documento aponta para
// `system-design-output/final_report.md`, para uma auditoria apagada, para
// `src/pages/settings.tsx` e para `docs/adr/adr-nomenclature.test.ts` — nenhum dos quais existe.
// Quem segue um deles conclui que o registro e inconferivel, o que e pior do que o documento nao
// citar nada.
//
// LIMITE HONESTO, declarado e nao descoberto depois: o extrator e uma regex sobre prosa. Ele nao
// pega todo caminho, e nao pode reprovar um caminho deliberadamente ILUSTRATIVO nem um que
// descreve, corretamente, um arquivo que foi apagado. Os dois casos tem marcador de dispensa, e o
// guarda relata quantos caminhos conferiu — um zero silencioso nao pode passar por cobertura.
// ---------------------------------------------------------------------------------------------

/** Documentos cujos caminhos citados sao conferidos. */
const DOCS_GOVERNADOS = [
  'DESIGN.md',
  'DOGFOOD.md',
  'TESTING.md',
  'docs/architecture.md',
  'docs/adr/README.md',
] as const;

/**
 * Um caminho entre crases que PARECE um arquivo do repositorio.
 *
 * Exige uma barra e uma extensao conhecida: sem isso, `Card.Body` e `npm run lint` viram caminhos.
 */
const CAMINHO_EM_PROSA = /`((?:[\w.@-]+\/)+[\w.-]+\.(?:ts|tsx|js|mjs|json|md|css|conf|yaml|yml))`/g;

/**
 * Dispensa a linha inteira da conferencia.
 *
 * `path/to/…` e ilustrativo. `(nao existe`/`NAO existe`/`does not exist`/`foi apagado` sao notas
 * historicas CORRETAS sobre um arquivo removido — reprova-las obrigaria a apagar a nota, que e a
 * informacao.
 */
function dispensada(linha: string): boolean {
  return /path\/to\/|nao existe|NAO existe|não existe|does not exist|foi apagado|was deleted|never existed|no longer exists/i.test(linha);
}

interface CaminhoQuebrado {
  readonly doc: string;
  readonly linha: number;
  readonly caminho: string;
}

/** Confere os caminhos citados. Devolve os quebrados e QUANTOS foram conferidos. */
function conferirCaminhos(): { quebrados: CaminhoQuebrado[]; conferidos: number } {
  const quebrados: CaminhoQuebrado[] = [];
  let conferidos = 0;
  for (const doc of DOCS_GOVERNADOS) {
    const linhas = readFileSync(join(DASHBOARD_ROOT, doc), 'utf-8').split('\n');
    linhas.forEach((linha, i) => {
      if (dispensada(linha)) return;
      for (const m of linha.matchAll(CAMINHO_EM_PROSA)) {
        const caminho = m[1];
        conferidos += 1;
        // As quatro bases que a prosa deste repositorio de fato usa, medidas e nao supostas:
        // a raiz do dashboard, a do umbrella (um nivel acima), `src/` (a convencao de
        // `architecture.md`, que fala de dentro do codigo) e o diretorio do proprio documento
        // (como `docs/architecture.md` citando `adr/0001-....md`).
        const dirDoDoc = doc.includes('/') ? doc.slice(0, doc.lastIndexOf('/')) : '.';
        const existe = [
          join(DASHBOARD_ROOT, caminho),
          join(DASHBOARD_ROOT, '..', caminho),
          join(DASHBOARD_ROOT, 'src', caminho),
          join(DASHBOARD_ROOT, dirDoDoc, caminho),
        ].some((c) => existsSync(c));
        if (!existe) quebrados.push({ doc, linha: i + 1, caminho });
      }
    });
  }
  return { quebrados, conferidos };
}

describe('as afirmações medidas da documentação batem com o disco', () => {
  it('nenhum documento afirma um número que o disco contradiz', () => {
    const { divergencias, conferidas } = conferirAfirmacoes();

    const relato = divergencias
      .map((d) =>
        d.afirmado === null
          ? `  ${d.doc} — "${d.sobre}": a frase MUDOU e a afirmação deixou de ser conferida ` +
            `(o disco diz ${String(d.medido)}). Reescrever o padrão em docs-claims.ts, ou a ` +
            'afirmação volta a ser não-verificada, que é o estado de onde viemos.'
          : `  ${d.doc} — "${d.sobre}": afirma ${String(d.afirmado)}, disco diz ${String(d.medido)}.`,
      )
      .join('\n');

    expect(
      divergencias,
      `\n${String(divergencias.length)} de ${String(conferidas)} afirmações medidas divergem do disco:\n\n${relato}\n\n` +
        'Corrigir o DOCUMENTO — o disco é a fonte. Se o número mudou por um refactor legítimo,\n' +
        'a mudança do documento faz parte do refactor, não de uma limpeza posterior.\n',
    ).toEqual([]);
  });

  it('o guarda diz quantas afirmações conferiu', () => {
    // Sem isto, uma tabela cujos padrões parassem todos de casar passaria verde provando nada —
    // a mesma forma inerte que B-152/B-189 nomeiam, um nível acima.
    const { conferidas } = conferirAfirmacoes();
    expect(conferidas).toBe(AFIRMACOES.length);
    expect(conferidas).toBeGreaterThan(0);
  });

  it('cada padrão tem exatamente um grupo de captura', () => {
    // Um padrão sem grupo devolveria `undefined`, `Number(undefined)` é NaN, e `NaN !== medido`
    // é sempre verdadeiro: a afirmação falharia por um motivo que não é o dela.
    for (const a of AFIRMACOES) {
      const grupos = new RegExp(`${a.padrao.source}|`).exec('')?.length ?? 0;
      expect(grupos - 1, `${a.doc} — ${a.sobre}`).toBe(1);
    }
  });

  // ---------------------------------------------------------------------------------------------
  // O guarda tem de conseguir REPROVAR. Um detector que nunca fica vermelho é exatamente o defeito
  // que esta varredura inteira está corrigindo em outras telas (B-152, B-189, B-191).
  // ---------------------------------------------------------------------------------------------

  // B-237 — estes auto-testes reimplementavam a comparação à mão (`padrao.exec` + `Number(...)`)
  // em vez de chamar `conferirAfirmacoes`. Provavam que a REGEX se comporta, e não que o DETECTOR
  // reporta: se ele parasse de empurrar divergências, os dois seguiriam verdes enquanto o guarda
  // inteiro deixava de guardar. Agora passam a afirmação falsa PELO detector.

  it('DETECTA uma afirmação que derivou', () => {
    const falsa: AfirmacaoNumerica = {
      doc: 'docs/architecture.md',
      sobre: 'self-test: a deliberately impossible count',
      padrao: /nas \*\*(\d+)\*\* subpastas de `src\/components\/`/,
      medir: () => 9999,
    };

    const { divergencias, conferidas } = conferirAfirmacoes([falsa]);

    expect(conferidas).toBe(1);
    expect(divergencias).toHaveLength(1);
    expect(divergencias[0].medido).toBe(9999);
    // O afirmado é o número REAL do documento — o padrão precisa ter casado, ou o auto-teste
    // estaria provando o caso da frase reescrita, que é o de baixo.
    expect(divergencias[0].afirmado).not.toBeNull();
    expect(divergencias[0].afirmado).not.toBe(9999);
  });

  it('DETECTA uma frase reescrita que deixou de ser conferida', () => {
    const falsa: AfirmacaoNumerica = {
      doc: 'docs/architecture.md',
      sobre: 'self-test: a pattern that matches nothing',
      padrao: /esta frase nao existe em lugar nenhum \((\d+)\)/,
      medir: () => 1,
    };

    const { divergencias } = conferirAfirmacoes([falsa]);

    // `afirmado: null` é o ponto: uma frase que mudou faz a afirmação deixar de ser conferida, e
    // isso É a falha — não um caso a pular.
    expect(divergencias).toHaveLength(1);
    expect(divergencias[0].afirmado).toBeNull();
  });

  it('e NÃO acusa uma afirmação que confere', () => {
    // Sem este contraponto, um detector que acusasse tudo passaria nos dois casos acima.
    const verdadeira: AfirmacaoNumerica = {
      doc: 'docs/architecture.md',
      sobre: 'self-test: a claim that holds',
      padrao: /nas \*\*(\d+)\*\* subpastas de `src\/components\/`/,
      medir: () => {
        const conteudo = readFileSync(join(DASHBOARD_ROOT, 'docs/architecture.md'), 'utf-8');
        return Number(/nas \*\*(\d+)\*\* subpastas de `src\/components\/`/.exec(conteudo)?.[1]);
      },
    };

    expect(conferirAfirmacoes([verdadeira]).divergencias).toEqual([]);
  });
});

describe('os caminhos que a documentação cita resolvem no disco', () => {
  it('nenhum documento governado aponta para um arquivo que não existe', () => {
    const { quebrados, conferidos } = conferirCaminhos();

    const relato = quebrados.map((q) => `  ${q.doc}:${String(q.linha)} → \`${q.caminho}\``).join('\n');

    expect(
      quebrados,
      `\n${String(quebrados.length)} de ${String(conferidos)} caminhos citados não resolvem:\n\n${relato}\n\n` +
        'Corrigir o caminho, ou — quando o arquivo foi apagado de propósito — dizer isso na\n' +
        'própria linha ("não existe", "was deleted"), que é o que dispensa a conferência. Apagar a\n' +
        'nota histórica para calar o guarda seria apagar a informação.\n',
    ).toEqual([]);
  });

  it('o guarda diz quantos caminhos conferiu', () => {
    // Um extrator cuja regex parasse de casar passaria verde tendo conferido nada.
    const { conferidos } = conferirCaminhos();
    expect(conferidos).toBeGreaterThan(10);
  });

  it('DETECTA um caminho que não existe', () => {
    // Auto-teste do extrator: a regex tem de casar a forma, e o predicado tem de reprová-la.
    const linha = 'veja `src/lib/este-arquivo-nao-existe.ts` para detalhes';
    const casados = [...linha.matchAll(/`((?:[\w.@-]+\/)+[\w.-]+\.(?:ts|tsx|js|mjs|json|md|css|conf|yaml|yml))`/g)];
    expect(casados).toHaveLength(1);
    expect(existsSync(join(DASHBOARD_ROOT, casados[0][1]))).toBe(false);
  });
});
