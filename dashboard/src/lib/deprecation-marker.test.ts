// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

/**
 * B-063 — todo shim de compatibilidade declara quando morre.
 *
 * ## O que a auditoria mediu
 *
 * Zero anotações `@deprecated` em 673 arquivos, contra 97 referências a legado
 * escritas em prosa. Ou seja: o repositório sabe o que é legado e conta isso em
 * comentário, num formato que nenhuma ferramenta lê e que nenhuma revisão cobra.
 *
 * O custo não é o campo velho — é que ele não tem data. Um `environment?` que
 * sobreviveu a três milestones parece parte do contrato para quem chega, e a
 * cada release fica mais caro remover, porque mais código passou a assumir que
 * ele existe.
 *
 * ## O que este teste exige
 *
 * Onde há prosa dizendo "legacy" ou "backward compat" **num tipo do contrato**,
 * tem de haver `@deprecated` com condição de sunset. Não é sobre o comentário
 * ser bonito: `@deprecated` é lido pelo editor, que risca o símbolo no
 * autocompletar — a diferença entre um aviso que o autor encontra e um que ele
 * precisaria procurar.
 *
 * ## Escopo deliberadamente estreito
 *
 * Só `src/lib/api/types.ts`, que é o espelho do contrato do backend e onde o
 * legado de fato mora. Prosa sobre legado numa página costuma descrever a
 * *lógica de fallback*, não um símbolo depreciado — exigir a tag ali produziria
 * ruído, e um gate ruidoso é desligado.
 *
 * A tag exige **condição de sunset**, não data: um prazo que ninguém controla é
 * ignorado no dia. "Remover quando o backend parar de emitir" é verificável.
 */
const CONTRATO = join(SRC, 'lib', 'api', 'types.ts');

/** Prosa que indica um símbolo mantido só por compatibilidade. */
const SINAIS = /\b(legacy|backward compat|legado)\b/i;

/**
 * Prosa que fala de legado no PASSADO — o campo já saiu, o comentário só conta a
 * história. Exigir `@deprecated` aí seria pedir a tag para um símbolo que não
 * existe, e o gate viraria ruído.
 *
 * A distinção importa mais do que parece: os quatro casos que esta lista exclui
 * são exatamente os que fariam alguém desligar o teste em vez de atendê-lo.
 */
const HISTORICO = /\b(was dropped|foi removido|REMOVIDO|Replaces the legacy|era legado|saiu com)\b/i;

function arquivos(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) arquivos(full, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

describe('marcador de depreciação (B-063)', () => {
  it('todo campo legado do contrato carrega @deprecated com sunset', () => {
    const linhas = readFileSync(CONTRATO, 'utf8').split('\n');
    const semTag: string[] = [];

    for (let i = 0; i < linhas.length; i++) {
      if (!SINAIS.test(linhas[i])) continue;
      // A janela cobre o comentário inteiro: "foi REMOVIDO" pode estar na linha
      // anterior ou na seguinte à palavra "legado".
      const vizinhanca = linhas.slice(Math.max(0, i - 3), i + 4).join('\n');
      if (HISTORICO.test(vizinhanca)) continue;
      // A tag pode estar ACIMA (JSDoc do próprio campo) ou ABAIXO (quando a prosa
      // é o comentário da interface e os campos anotados vêm depois). Procurar só
      // para cima produzia falso positivo em `AuditEntry`, cujo docblock lista os
      // aliases antes de declará-los.
      const janela = linhas.slice(Math.max(0, i - 12), i + 14).join('\n');
      // Escape explícito para o caso em que o LEGADO é o VALOR e não o campo —
      // `project?: string` não está depreciado; o que é legado é a string vazia.
      // Exigir @deprecated ali afirmaria algo falso sobre o campo.
      if (janela.includes('legacy-value-ok')) continue;
      if (!janela.includes('@deprecated')) {
        semTag.push(`lib/api/types.ts:${i + 1} — ${linhas[i].trim().slice(0, 80)}`);
      }
    }

    expect(
      semTag,
      'Prosa sobre legado no contrato sem `@deprecated` acima.\n\n' +
        'Um campo mantido por compatibilidade precisa de data de morte, senão vira\n' +
        'contrato por inércia — e a cada release fica mais caro remover, porque mais\n' +
        'código passou a assumir que ele existe.\n\n' +
        'Formato: @deprecated <item> — <por que existe>. Sunset: <condição verificável>.\n' +
        'CONDIÇÃO, não data: um prazo que ninguém controla é ignorado no dia.\n',
    ).toEqual([]);
  });

  it('toda anotação @deprecated declara a condição de sunset', () => {
    const semSunset: string[] = [];
    for (const f of arquivos(SRC)) {
      const src = readFileSync(f, 'utf8');
      if (!src.includes('@deprecated')) continue;
      const rel = relative(SRC, f).replace(/\\/g, '/');
      // Cada bloco @deprecated tem de conter "Sunset" em até 10 linhas.
      const linhas = src.split('\n');
      linhas.forEach((l, i) => {
        if (!l.includes('@deprecated')) return;
        const bloco = linhas.slice(i, i + 10).join('\n');
        if (!/sunset/i.test(bloco)) semSunset.push(`${rel}:${i + 1}`);
      });
    }

    expect(
      semSunset,
      '`@deprecated` sem condição de sunset. A tag sozinha diz "não use"; sem a\n' +
        'condição, ninguém sabe o que precisa ser verdade para remover — e o símbolo\n' +
        'fica depreciado para sempre, que é o mesmo que não estar depreciado.\n',
    ).toEqual([]);
  });
});
