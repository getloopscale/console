import { describe, it, expect } from 'vitest';
import { render } from '@/test/render';
import { PRIMARY_CANONICO, TEMA_THEO } from './theo-theme';

/**
 * B-007 — o tema tem UM dono, e o teste renderiza o mesmo que o app.
 *
 * ## Os três donos que a medição achou
 *
 * O item alegava "três donos em três versões". Medido em 2026-08-08, são estes:
 *
 * | Dono | `--primary` que produz | Onde vale |
 * |---|---|---|
 * | `violetForge` do pacote (cru) | `oklch(0.50 0.16 296.97)` | onde ninguém sobrescreve |
 * | `main.tsx` | `oklch(0.57 0.13 302)` | o app |
 * | `test/render.tsx` | `oklch(0.50 0.16 296.97)` | **toda a suíte** |
 *
 * `test/render.tsx` montava `<ThemeProvider themes={[violetForge]}>` — o objeto
 * **cru**, sem o override do `main.tsx`. E não passava `respectSystemMode:
 * false`, então o provider seguia o `prefers-color-scheme` do ambiente; em jsdom
 * ele é `light`, e o atributo saía `data-mode="light"`.
 *
 * O resultado medido: **toda a suíte renderizava o dashboard em modo claro, com
 * um roxo que o app nunca mostra** — num produto travado em escuro (`D1`).
 *
 * Isso não é cosmético. O `--primary` foi escurecido por CONTRASTE, no Red Team
 * `theo/theo#163`: o default do pacote dá 3,87:1 de branco sobre primary e
 * reprova o WCAG AA; o valor do app dá ~4,73:1 e passa. Existe `test/a11y.test.tsx`
 * nesta suíte. Ele media a cor errada.
 *
 * ## Por que este teste lê o valor COMPUTADO
 *
 * `index.primary-token.test.ts` (B-034) compara os TEXTOS de `main.tsx` e
 * `index.css` e diz de si mesmo que não substitui a medição, porque *"fixar o
 * valor COMPUTADO exige Playwright (jsdom não resolve cascade de `@import`)"*.
 *
 * **Isso foi medido e é falso.** O tema não chega por `@import`: o provider
 * injeta um `<style>` com seletor `[data-theme="violet-forge"][data-mode="…"]` e
 * põe os atributos no `<html>`. jsdom resolve seletor de atributo em
 * `getComputedStyle` — verificado injetando `oklch(0.99 0.99 99)` no tema e
 * lendo exatamente esse valor de volta.
 *
 * Então o teste que o DoD do B-007 pedia é escrevível aqui, sem Playwright, e é
 * este. Ele pega o que o teste textual não pega: um bump do pacote que mude quem
 * vence, ou uma árvore de teste configurada diferente do app.
 */

describe('tema do design system (B-007)', () => {
  it('a árvore de TESTE computa o mesmo --primary que o app', () => {
    render(<div />);

    const computado = getComputedStyle(document.documentElement)
      .getPropertyValue('--primary')
      .trim();

    expect(
      computado,
      'A suíte renderiza um --primary diferente do app.\n\n' +
        'O valor do app foi escolhido por CONTRASTE (Red Team theo/theo#163): o\n' +
        'default do pacote reprova o WCAG AA em branco-sobre-primary. Se a suíte\n' +
        'renderiza outro, `test/a11y.test.tsx` mede uma cor que ninguém vê.\n\n' +
        'A causa provável é a árvore de teste montar o tema por conta própria em\n' +
        'vez de importar `lib/theme/theo-theme.ts`, que é o dono único.\n',
    ).toBe(PRIMARY_CANONICO);
  });

  it('a árvore de teste renderiza em modo ESCURO, como o app', () => {
    render(<div />);

    expect(
      document.documentElement.getAttribute('data-mode'),
      'A suíte renderiza o dashboard em modo claro.\n\n' +
        'O produto é travado em escuro (D1 — nunca houve seletor de tema). O\n' +
        'provider segue o `prefers-color-scheme` do ambiente quando\n' +
        '`respectSystemMode` não é desligado, e em jsdom esse valor é `light`.\n\n' +
        '`respectSystemMode: false` e `storageKey: null` fazem parte da configuração\n' +
        'do tema — não são detalhe do `main.tsx`.\n',
    ).toBe('dark');
  });

  it('o dono único cobre as DUAS variantes, não só a escura', () => {
    // O app trava escuro, então é tentador sobrescrever só `dark`. Mas o
    // provider escolhe a variante em runtime, e uma sessão que caia em claro por
    // qualquer motivo passaria a mostrar o roxo que reprova o AA — sem nada
    // acusar, porque o modo escuro continuaria certo.
    const tema = TEMA_THEO.themes[0];
    expect(tema.light?.primary, 'variante clara sem o primary canônico').toBe(PRIMARY_CANONICO);
    expect(tema.dark?.primary, 'variante escura sem o primary canônico').toBe(PRIMARY_CANONICO);
  });
});
