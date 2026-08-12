// @vitest-environment node
//
// O guard varre a arvore sintatica de 416 arquivos e nao toca em DOM. Sob o `jsdom` que a
// suite usa por padrao, o mesmo trabalho custava 23,8 s; em ambiente `node`, uma fracao
// disso. Um teste lento e um teste que alguem acaba pulando.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { varrerInterface } from '@/test/i18n-guard';

const SRC = resolve(__dirname, '..');

/**
 * O produto fala uma língua só — e este é o guard que a mantém (B-108/B-109/B-110).
 *
 * ## O que foi medido
 *
 * Em 2026-08-10, com o dashboard em modo mock, uma varredura de 20 rotas em navegador mostrou
 * dezoito em inglês e duas não: `/promptly` inteira e `/trust` parcialmente. O scanner de AST
 * então contou **203 strings de interface em português** em `src/`, com 176 localizadores de
 * teste dependendo delas.
 *
 * ## Por que um guard, e não só a tradução
 *
 * O commit `05132088` (2026-08-04) já tinha feito exatamente este trabalho no domínio Skills —
 * rotas e rótulos migrados, com redirect para não quebrar link salvo. Ele **não deixou guard**,
 * e três meses depois o próprio Skills tinha 4 strings novas em português.
 *
 * Limpar sem impedir que suje é limpar de novo depois. A diferença entre este plano e aquele
 * commit é este arquivo.
 */
describe('o dashboard fala uma língua só', () => {
  it('nenhuma string de interface em português em `src/`', () => {
    const achados = varrerInterface(SRC);

    const amostra = achados
      .slice(0, 40)
      .map((a) => `  ${a.arquivo}:${a.linha}  ${a.trecho}`)
      .join('\n');

    expect(
      achados,
      `Texto de interface em português no dashboard (${achados.length} ocorrência(s)).\n\n` +
        'O produto é em inglês. Uma tela em outro idioma dentro dele não lê como tradução\n' +
        'pendente — lê como uma parte que veio de outro lugar.\n\n' +
        `${amostra}${achados.length > 40 ? `\n  … e mais ${achados.length - 40}` : ''}\n\n` +
        'Este guard lê a ÁRVORE SINTÁTICA, não o texto do arquivo: comentário em português é\n' +
        'a convenção deste repositório e NÃO é acusado. Se algo aqui é comentário, o guard\n' +
        'tem um defeito e o lugar de consertar é `i18n-guard.ts` — nunca afrouxar o marcador.\n',
    ).toEqual([]);
  });

  it('comentário em português não é acusado — o guard não confunde convenção com defeito', () => {
    // A contraparte positiva, e ela é o que separa este guard de um `grep`.
    //
    // Sem este caso, o guard poderia estar certo por acidente: bastaria o marcador nunca ter
    // encontrado um comentário para o defeito ficar latente até o dia em que encontrasse — e
    // nesse dia alguém o desligaria em vez de consertá-lo.
    const dir = mkdtempSync(join(tmpdir(), 'i18n-guard-'));
    try {
      writeFileSync(
        join(dir, 'exemplo.tsx'),
        [
          '// Este comentário está em português e explica uma decisão de arquitetura.',
          '/**',
          ' * Docblock também em português, com acentuação: função, revisão, ambiente.',
          ' */',
          'export function Exemplo() {',
          '  // outra explicação em português: não confundir com interface',
          '  return <p title="Delete environment">Delete this environment?</p>;',
          '}',
        ].join('\n'),
        'utf8',
      );

      expect(
        varrerInterface(dir),
        'o guard acusou um comentário — ele está lendo texto em vez de árvore sintática',
      ).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('o guard ENXERGA uma string de interface em português — não passa por vacuidade', () => {
    // A terceira perna: os dois casos acima passariam com um scanner que não devolve nada
    // nunca. Este prova que ele encontra o que existe para encontrar.
    const dir = mkdtempSync(join(tmpdir(), 'i18n-guard-'));
    try {
      writeFileSync(
        join(dir, 'ruim.tsx'),
        'export const X = () => <p title="Não foi possível carregar">Nova revisão</p>;\n',
        'utf8',
      );

      const achados = varrerInterface(dir);
      expect(achados.length, 'o guard não viu texto de interface em português').toBeGreaterThanOrEqual(2);
      expect(achados.map((a) => a.trecho).join(' | ')).toMatch(/Nova revisão|Não foi possível/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
