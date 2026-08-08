import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { queryClient } from '@/lib/http/query-client';

const SRC = resolve(__dirname, '..');

/**
 * B-077 — todo override de política de cache diverge do default, ou some.
 *
 * ## O que o item dizia, e o que a medição achou
 *
 * O item registra que "nenhum modelo de consistência foi declarado". **Isso está
 * errado**: `lib/http/query-client.ts` declara o modelo inteiro, com justificativa
 * por default — `staleTime` 60s espelhando o TTL que existia antes, `gcTime` 5min,
 * revalidação em foco e reconexão, e um `retryGuard` que só repete falha
 * transitória (5xx e rede) porque repetir um 404 ou 403 gasta uma ida à rede e
 * atrasa o "não encontrado" que a pessoa está esperando. Esse guard nasceu de um
 * Red Team, não de gosto.
 *
 * O que a medição achou é outra coisa: **32 overrides locais**, e dois deles
 * repetiam exatamente o default global.
 *
 * ## Por que repetir o default é um defeito
 *
 * `scope-switcher.tsx:42` e `use-build-stats.ts:41` escreviam
 * `staleTime: 60_000` com comentário justificando a escolha. O valor está certo
 * hoje — e é por isso que passa despercebido.
 *
 * O problema aparece no dia em que o default global mudar: esses dois ficam
 * **congelados em 60s**, sozinhos, sem que nada acuse. O comentário continuará
 * afirmando uma intenção ("manter o seletor ágil sem martelar o BFF") que a linha
 * deixou de entregar, e quem ler vai acreditar no comentário.
 *
 * Um override tem de existir para **divergir**. Se ele concorda com o default, o
 * default é que deve ser lido — assim ele muda para todo mundo de uma vez.
 *
 * ## O que este teste NÃO faz
 *
 * Não proíbe override. `use-whoami.ts` declara `staleTime: Infinity` porque o
 * whoami só muda em troca de time ou logout; `use-project-status` faz polling de
 * 5s porque é uma tela de runtime. Os dois divergem do default de propósito, e é
 * exatamente para isso que o override existe.
 */

/** As opções cujo default global é conhecido e comparável. */
const DEFAULTS = queryClient.getDefaultOptions().queries ?? {};

function arquivos(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) arquivos(full, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

describe('política de cache (B-077)', () => {
  it('o modelo global existe e é o único lugar sem justificativa local', () => {
    // O item diz "nenhum modelo declarado". Esta asserção é o desmentido, e
    // existe para que a próxima auditoria não repita a leitura.
    expect(DEFAULTS.staleTime).toBe(60_000);
    expect(DEFAULTS.gcTime).toBe(5 * 60_000);
    expect(DEFAULTS.refetchOnWindowFocus).toBe(true);
    expect(typeof DEFAULTS.retry).toBe('function');
  });

  it('nenhum override repete o default — override existe para DIVERGIR', () => {
    const redundantes: string[] = [];

    for (const f of arquivos(SRC)) {
      if (f.endsWith('query-client.ts')) continue; // é o dono do default
      const linhas = readFileSync(f, 'utf8').split('\n');
      linhas.forEach((linha, i) => {
        const m = /^\s*(staleTime|gcTime):\s*([0-9_]+)\s*,/.exec(linha);
        if (!m) return;
        const valor = Number(m[2].replace(/_/g, ''));
        const chave = m[1] as 'staleTime' | 'gcTime';
        if (valor === DEFAULTS[chave]) {
          redundantes.push(`${relative(SRC, f).replace(/\\/g, '/')}:${i + 1} — ${chave}: ${m[2]}`);
        }
      });
    }

    expect(
      redundantes,
      'Override que repete o default global.\n\n' +
        'O valor está certo hoje, e é por isso que passa despercebido. No dia em\n' +
        'que o default mudar, esta linha fica congelada sozinha — sem que nada\n' +
        'acuse, e com um comentário afirmando uma intenção que ela deixou de\n' +
        'entregar.\n\n' +
        'Um override existe para DIVERGIR. Se ele concorda com o default, apague-o:\n' +
        'assim o default passa a valer, e muda para todo mundo de uma vez.\n\n' +
        'Ver `lib/http/query-client.ts` para o modelo e a justificativa de cada\n' +
        'default.\n',
    ).toEqual([]);
  });
});
