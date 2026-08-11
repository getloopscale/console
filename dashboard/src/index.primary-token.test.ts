import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRIMARY_CANONICO } from '@/lib/theme/theo-theme';

/**
 * B-034 — o token `--primary` tem UM dono, e as duas fontes concordam.
 *
 * ## O que estava errado
 *
 * `--primary` era declarado em dois lugares, com valores DIFERENTES, e cada um
 * com um docblock afirmando ser o que vale em runtime:
 *
 *   main.tsx:91   `oklch(0.57 0.13 302)` — "o index.css NAO tem efeito no primary"
 *   index.css:148 `oklch(0.50 0.16 296.97)` — "This is the block the app actually uses"
 *
 * As duas nao podiam estar certas, ambas citavam medicoes WCAG, e nenhum teste
 * distinguia. O contraste real da marca era indeterminado por leitura.
 *
 * ## A medicao que resolveu
 *
 * Servido o build (`vite preview`) e lido em Chrome headless com `.dark` ativo:
 *
 *   getComputedStyle(document.documentElement)['--primary'] === 'oklch(0.57 0.13 302)'
 *
 * O tema do `TheoUIProvider` vence porque aplica no ELEMENTO, o que precede folha
 * de estilo na cascata. O docblock do main.tsx estava certo; o do index.css,
 * errado. O CSS foi alinhado ao vencedor em vez de apagado — ele ainda pinta a
 * tela entre o primeiro paint e o React montar, e divergir ali produzia um flash
 * da cor errada.
 *
 * ## Por que este teste e textual, e o que ele NAO prova
 *
 * Ele afirma que as duas fontes DECLARAM o mesmo valor. Isso e o que impede a
 * divergencia voltar — que foi o defeito real. Ele NAO substitui a medicao: se um
 * bump de `@usetheo/ui` ou `@theokit/ui` mudar quem vence na cascata, este teste
 * segue verde. Fixar o valor COMPUTADO exige Playwright (jsdom nao resolve
 * cascade de `@import`), e esse teste e o passo seguinte, registrado em B-034.
 */
// B-007 — o valor deixou de ser lido do `main.tsx` porque saiu de lá: a config
// do tema virou `lib/theme/theo-theme.ts`, importada pelo app E pela árvore de
// teste. Antes disso as duas divergiam, e a suíte inteira renderizava em modo
// claro com um roxo que o app nunca mostra.
//
// A constante vem do módulo dono em vez de repetida aqui: repeti-la faria este
// teste passar sozinho no dia em que o tema mudasse, comparando um literal
// obsoleto consigo mesmo.
const PRIMARY_MEDIDO = PRIMARY_CANONICO;
const ROOT = resolve(__dirname, '..');

describe('token --primary (B-034)', () => {
  it('o dono do tema declara o valor medido em runtime', () => {
    const tema = readFileSync(resolve(ROOT, 'src/lib/theme/theo-theme.ts'), 'utf8');
    expect(tema).toContain(PRIMARY_MEDIDO);
  });

  it('o CSS de fallback declara o MESMO valor — sem flash de cor divergente', () => {
    const css = readFileSync(resolve(ROOT, 'src/index.css'), 'utf8');
    const declaracoes = [...css.matchAll(/^\s*--primary:\s*([^;]+);/gm)].map((m) => m[1].trim());

    expect(declaracoes.length).toBeGreaterThan(0);
    for (const valor of declaracoes) {
      expect(valor).toBe(PRIMARY_MEDIDO);
    }
  });

  it('nenhuma fonte declara o valor PERDEDOR', () => {
    // `oklch(0.50 0.16 296.97)` era o que o index.css afirmava ser o efetivo.
    // Ele pode aparecer em PROSA (o docblock explica a historia), mas nao como
    // declaracao ativa.
    const css = readFileSync(resolve(ROOT, 'src/index.css'), 'utf8');
    const ativas = [...css.matchAll(/^\s*--primary:\s*([^;]+);/gm)].map((m) => m[1].trim());
    expect(ativas).not.toContain('oklch(0.50 0.16 296.97)');
  });
});
