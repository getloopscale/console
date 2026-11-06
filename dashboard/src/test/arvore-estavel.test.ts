// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { comparar, houveMudanca, relatorio, type Assinatura } from './arvore-estavel';

/**
 * B-099 — a lógica do detector, testada sem subir a suíte inteira.
 *
 * O `globalSetup` que o consome só pode ser exercitado rodando tudo; separar a
 * comparação em função pura é o que a torna verificável em milissegundos.
 */

const sig = (pares: Record<string, string>): Assinatura => new Map(Object.entries(pares));

describe('detector de árvore instável (B-099)', () => {
  it('árvore idêntica não acusa nada', () => {
    const a = sig({ 'a.ts': '10:100', 'b.ts': '20:200' });
    expect(houveMudanca(comparar(a, a))).toBe(false);
  });

  it('acusa o arquivo REMOVIDO — é este o caso que produziu o defeito', () => {
    // A assinatura reproduzida em 2026-08-09: um módulo muito importado
    // desaparece por milissegundos durante uma reescrita, e quem estiver
    // resolvendo naquele instante recebe `Failed to resolve import`.
    const m = comparar(sig({ 'x.ts': '1:1', 'ui/alert-guard.tsx': '9:9' }), sig({ 'x.ts': '1:1' }));
    expect(m.removidos).toEqual(['ui/alert-guard.tsx']);
    expect(houveMudanca(m)).toBe(true);
    expect(relatorio(m)).toContain('alert-guard');
  });

  it('acusa conteúdo alterado, mesmo com o tamanho igual', () => {
    // Só o tamanho não bastaria: uma edição que troque uma letra por outra
    // mantém os bytes e muda o comportamento. O `mtime` entra por isso.
    const m = comparar(sig({ 'a.ts': '10:100' }), sig({ 'a.ts': '10:999' }));
    expect(m.alterados).toEqual(['a.ts']);
  });

  it('acusa arquivo novo', () => {
    const m = comparar(sig({}), sig({ 'novo.ts': '1:1' }));
    expect(m.criados).toEqual(['novo.ts']);
  });

  it('o relatório diz o que aconteceu, não só que aconteceu', () => {
    // O valor inteiro do detector está aqui: a mensagem precisa nomear a CAUSA,
    // porque o erro que o usuário vê (`Does the file exist?`) manda procurar um
    // arquivo que existe. Foi essa contradição que custou um dia.
    const texto = relatorio(comparar(sig({ 'a.ts': '1:1' }), sig({})));
    expect(texto).toContain('MUDOU DURANTE A EXECUÇÃO');
    expect(texto).toContain('Failed to resolve import');
    expect(texto).toContain('B-099');
  });
});
