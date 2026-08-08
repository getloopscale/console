import { violetForge } from '@theokit/ui';

/**
 * A configuração do tema do dashboard — o dono ÚNICO.
 *
 * ## Por que este arquivo existe (B-007)
 *
 * A configuração vivia inteira dentro do `main.tsx`, e a árvore de teste
 * (`test/render.tsx`) montava a **sua própria**, com o `violetForge` cru. As
 * duas divergiam em duas dimensões ao mesmo tempo, e nada acusava:
 *
 * | | `--primary` | modo |
 * |---|---|---|
 * | app | `oklch(0.57 0.13 302)` | escuro |
 * | suíte | `oklch(0.50 0.16 296.97)` | **claro** |
 *
 * Toda a suíte renderizava um produto travado em escuro no modo claro, com um
 * roxo que ninguém vê. Config duplicada não diverge porque alguém errou —
 * diverge porque só um dos dois lados é atualizado quando algo muda.
 *
 * ## Por que o `primary` não é o do pacote
 *
 * Red Team `theo/theo#163`, WCAG 1.4.3. O default do `violetForge`
 * (`oklch(0.50 0.16 296.97)`, e antes dele `oklch(0.628 0.225 296)`) dá 3,87:1
 * de branco sobre primary — reprova o AA para texto normal. O valor daqui é um
 * roxo Dracula neutro (croma 0,13 · matiz 302) e dá ~4,73:1.
 *
 * ## Por que as duas variantes recebem o mesmo valor
 *
 * O app trava escuro, então sobrescrever só `dark` parece bastar. Não basta: o
 * provider escolhe a variante em runtime, e uma sessão que caia em claro por
 * qualquer motivo passaria a mostrar o roxo que reprova o AA — com o modo
 * escuro continuando certo, então nada acusaria.
 *
 * ## `respectSystemMode` e `storageKey` fazem parte do tema
 *
 * Não são detalhe de bootstrap. Sem `respectSystemMode: false` o provider segue
 * o `prefers-color-scheme` e um usuário com o SO em claro vê o app claro. Sem
 * `storageKey: null`, uma sessão anterior que tenha gravado `mode=light`
 * continua sobrescrevendo o `defaultMode` — não há o que persistir num tema
 * travado.
 *
 * Foi exatamente por não carregarem estes dois que os testes caíram em claro.
 */

/**
 * O `--primary` do produto. Fixado aqui porque é um valor de CONTRASTE, não de
 * gosto: `lib/theme/theo-theme.test.tsx` compara o computado contra ele, e
 * `index.primary-token.test.ts` compara o fallback de CSS contra o mesmo.
 */
export const PRIMARY_CANONICO = 'oklch(0.57 0.13 302)';

// Sem `as const`: ele tornaria `themes` readonly, e o `ThemeProvider` pede um
// `Theme[]` mutável. Congelar aqui só produziria um cast na hora de usar.
export const TEMA_THEO = {
  themes: [
    {
      ...violetForge,
      light: { ...violetForge.light, primary: PRIMARY_CANONICO },
      dark: { ...violetForge.dark, primary: PRIMARY_CANONICO },
    },
  ],
  defaultTheme: 'violet-forge',
  defaultMode: 'dark' as const,
  // Locked dark (D1): o dashboard nunca ofereceu seletor de tema.
  respectSystemMode: false,
  storageKey: null,
};
