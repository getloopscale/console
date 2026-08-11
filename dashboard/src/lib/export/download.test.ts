import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { triggerDownload, triggerBlobDownload } from './download';

/**
 * B-230 — o padrão Blob+âncora existia TRÊS vezes, e a fonte que se declarava única não servia
 * o terceiro caso.
 *
 * `triggerDownload` só aceitava `string`, então o download binário de `workspace/overview.tsx` se
 * serviu sozinho — e, ao fazê-lo, perdeu as duas proteções que o docblock canônico documenta:
 * `appendChild` antes do `click()`, e o revoke ADIADO. Revogar a URL do objeto no ato aborta o
 * download antes de o Safari terminar de transmitir.
 *
 * A cópia não nasceu por descuido; nasceu porque a fonte única não cobria o caso. Alargar a
 * assinatura é o que torna a declaração verdadeira.
 */

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('triggerBlobDownload', () => {
  it('mantém as duas proteções que a terceira cópia tinha perdido', () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');

    triggerBlobDownload('f.bin', new Blob([new Uint8Array([1, 2, 3])]));

    expect(appendSpy).toHaveBeenCalled();
    // Adiado, não imediato: revogar aqui aborta o download em Safari/Firefox.
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('usa o nome de arquivo que recebeu', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    triggerBlobDownload('relatorio.bin', new Blob(['x']));

    const a = document.body.querySelector('a');
    expect(a?.download).toBe('relatorio.bin');
  });
});

describe('triggerDownload', () => {
  it('continua servindo o caminho de texto, agora por cima do binário', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    triggerDownload('a.csv', 'x,y', 'text/csv');

    expect(document.body.querySelector('a')?.download).toBe('a.csv');
  });
});

describe('a consolidação é real, não declarada', () => {
  it('nenhum outro módulo constrói a âncora de download por conta própria', () => {
    // A prova de que a consolidação aconteceu é um grep. Sem este caso, a quarta cópia nasce e os
    // testes acima continuam verdes — porque eles só falam da fonte canônica, que continua certa.
    const raiz = resolve(__dirname, '../..');
    const arquivos: string[] = [];
    const pilha = [raiz];
    while (pilha.length > 0) {
      const atual = pilha.pop();
      if (atual === undefined) break;
      for (const nome of readdirSync(atual)) {
        const caminho = join(atual, nome);
        if (statSync(caminho).isDirectory()) pilha.push(caminho);
        else if (/\.tsx?$/.test(nome) && !nome.includes('.test.')) arquivos.push(caminho);
      }
    }

    const culpados = arquivos
      .filter((f) => !f.endsWith('lib/export/download.ts'))
      .filter((f) => /createElement\(\s*['"]a['"]\s*\)/.test(readFileSync(f, 'utf-8')))
      .map((f) => relative(raiz, f));

    expect(
      culpados,
      `\nMódulo(s) construindo a âncora de download por conta própria:\n  ${culpados.join('\n  ')}\n\n` +
        'Use `triggerDownload` (texto) ou `triggerBlobDownload` (bytes) de `lib/export/download.ts`.\n' +
        'A cópia anterior perdeu o `appendChild` e o revoke adiado, e o download quebrava no Safari.\n',
    ).toEqual([]);
  });

  it('o varredor ainda enxerga arquivos — um zero silencioso não passa por cobertura', () => {
    const raiz = resolve(__dirname, '../..');
    expect(readdirSync(raiz).length).toBeGreaterThan(3);
  });
});
