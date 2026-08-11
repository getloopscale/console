import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

/**
 * B-099 — detecta que `src/` foi MUTADO durante a execução da suíte.
 *
 * ## A causa que este módulo nomeia
 *
 * `npm test` falhou em 2026-08-07 01:09 com
 * `Failed to resolve import "@/components/ui/alert-guard"`, e passou 15 minutos
 * depois na mesma árvore. Sete hipóteses foram levantadas e refutadas — cache
 * frio, vitest concorrentes, contenção de worker, descritores de arquivo, teste
 * escrevendo em disco, dependência atualizada, arquivo recém-criado.
 *
 * A oitava foi **demonstrada** em vez de suposta: reescrever concorrentemente um
 * módulo muito importado, enquanto a suíte roda, produz a assinatura EXATA:
 *
 *     Error: Failed to resolve import "@/components/ui/alert-guard"
 *            from "src/pages/lens/traces.tsx". Does the file exist?
 *
 * E o resto da evidência encaixa: o estado COMMITADO às 01:09 estava consistente
 * (o arquivo existia, os imports resolviam), havia commits às 01:04 e 01:05 —
 * uma sessão de edição ativa quatro minutos antes — e 36 execuções em árvore
 * estável nunca reproduziram.
 *
 * ## Por que isso NÃO ameaça o gate de CI
 *
 * O item se preocupava com "a suíte é gate de CI". O CI faz checkout limpo e
 * nada edita a árvore durante a execução, então o mecanismo não ocorre lá. Ele
 * ocorre localmente, quando alguém (ou um agente) edita enquanto a suíte roda.
 *
 * ## O que este módulo faz, e o que ele deliberadamente NÃO faz
 *
 * Ele **não impede** a edição concorrente — impedir exigiria travar a árvore, o
 * que atrapalharia o trabalho legítimo de quem roda a suíte enquanto escreve.
 *
 * Ele transforma um erro de resolução, que manda a pessoa procurar um arquivo
 * que existe, numa frase que diz o que aconteceu. A diferença entre os dois é um
 * dia de investigação — foi o que este item custou.
 */

/** Assinatura de `src/`: caminho → (tamanho, mtime em ms). */
export type Assinatura = Map<string, string>;

const IGNORAR = new Set(['node_modules', '.vite', 'coverage']);

export function assinar(dir = SRC, out: Assinatura = new Map()): Assinatura {
  for (const entrada of readdirSync(dir)) {
    if (IGNORAR.has(entrada)) continue;
    const caminho = join(dir, entrada);
    const st = statSync(caminho);
    if (st.isDirectory()) assinar(caminho, out);
    else out.set(relative(SRC, caminho), `${st.size}:${st.mtimeMs}`);
  }
  return out;
}

export interface Mudanca {
  criados: string[];
  removidos: string[];
  alterados: string[];
}

export function comparar(antes: Assinatura, depois: Assinatura): Mudanca {
  const criados: string[] = [];
  const removidos: string[] = [];
  const alterados: string[] = [];
  for (const [k, v] of depois) {
    if (!antes.has(k)) criados.push(k);
    else if (antes.get(k) !== v) alterados.push(k);
  }
  for (const k of antes.keys()) if (!depois.has(k)) removidos.push(k);
  return { criados, removidos, alterados };
}

export function houveMudanca(m: Mudanca): boolean {
  return m.criados.length + m.removidos.length + m.alterados.length > 0;
}

/** O aviso que substitui um dia de investigação. */
export function relatorio(m: Mudanca): string {
  const linhas = [
    '',
    '  ⚠  `src/` MUDOU DURANTE A EXECUÇÃO DA SUÍTE.',
    '',
    '  Isto não é (necessariamente) falha de teste. Um módulo reescrito enquanto',
    '  a suíte roda produz `Failed to resolve import "…". Does the file exist?`',
    '  para qualquer arquivo que estivesse resolvendo naquele instante — e o',
    '  arquivo existe quando você vai olhar depois.',
    '',
    '  Foi o que aconteceu em 2026-08-07 (B-099), e custou um dia para nomear.',
    '',
  ];
  const secao = (titulo: string, itens: string[]) =>
    itens.length ? [`  ${titulo} (${itens.length}):`, ...itens.slice(0, 10).map((f) => `    · ${f}`)] : [];
  linhas.push(
    ...secao('removidos', m.removidos),
    ...secao('criados', m.criados),
    ...secao('alterados', m.alterados),
    '',
  );
  return linhas.join('\n');
}
