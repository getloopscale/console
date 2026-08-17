/**
 * As constantes da tela de detalhe do prompt.
 *
 * Elas desceram do `detail.tsx` (B-009) porque o painel de abas passou a
 * precisar das três. Deixá-las na origem obrigaria um arquivo de `detail/` a
 * importar `detail` — o import de barril pai que `parent-barrel-import.test.ts`
 * proíbe, e que em ESM produz TDZ quando vira ciclo.
 *
 * Passá-las por PROP também estava errado, e por outra razão: prop é para o que
 * varia entre renders. Uma constante de módulo passada por prop finge ser
 * estado, e o leitor perde tempo procurando quem a muda.
 */

// M15 — a janela do agregado de uso. Curta por padrão e DITA na tela (ver a
// coluna "Uso"): implícita, o operador atribuiria o número ao período errado.
export const USAGE_WINDOW_DAYS = 7;

/**
 * Os rótulos que contam como produção.
 *
 * Um conjunto, e não um `===`, porque os dois convivem no catálogo real deste
 * ambiente — há prompts servindo `production` e outros servindo `prod`.
 */
export const PRODUCTION_ENVIRONMENTS = new Set(['production', 'prod']);

export const CONSUMPTION_BASE =
  typeof window === 'undefined' ? '/v1/promptly' : `${window.location.origin}/v1/promptly`;

/**
 * Qual ambiente o trecho de consumo publica.
 *
 * Produção vence; na ausência dela, o primeiro declarado. O `/review` mediu que o fallback é
 * DETERMINÍSTICO (o repositório ordena por label) mas **arbitrário**: um prompt com `canary` e
 * `staging` publica `canary` porque C vem antes de S. A escolha em si é defensável — publicar
 * versão fixa seria pior —, e o que faltava era a tela DIZER que não é produção. Ver
 * `ambienteEProducao`.
 */
export function snippetEnvironment(
  ponteiros: readonly { readonly label: string; readonly version: number }[],
): string | null {
  return (
    ponteiros.find((p) => PRODUCTION_ENVIRONMENTS.has(p.label))?.label ?? ponteiros[0]?.label ?? null
  );
}
