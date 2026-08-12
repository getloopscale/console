import { safeNavigator } from '@/lib/navigation';

/**
 * POST de um flow OIDC do Kratos por form DOM nativo.
 *
 * CRITICAL (EC-4 do login.tsx v1): tem de ser `form.submit()` de verdade, não `fetch`.
 * O Kratos exige um POST de nível de navegador para que o redirect ao provider seja
 * seguido; com `fetch` o 302 volta e o browser nunca navega — o login com GitHub/Google
 * quebra em silêncio.
 *
 * Extraído de `login.tsx` por dois motivos, nessa ordem:
 *
 *  1. O clique retomado (theo#140) precisa reexecutar o POST — e SÓ o POST. Reexecutar o
 *     comando inteiro reemitia `auth.method.attempt`, dando dois eventos com
 *     correlation_ids distintos para um único clique do usuário.
 *  2. `login.tsx` estava em 500 linhas EXATAS, colado no teto de `login-loc-budget.test.ts`.
 *     O commit anterior registrou isso como frágil de conviver; esta extração devolve folga
 *     em vez de compactar código para caber.
 */
export function postOIDCForm(
  action: string,
  csrfToken: string,
  provider: string,
): boolean {
  // B-138: `action` is `flow.ui.action`, chosen by the Kratos response. Returns false when
  // the boundary refuses it so the caller can surface an error instead of a dead click.
  return safeNavigator.submitTo(action, {
    csrf_token: csrfToken,
    method: 'oidc',
    provider,
  });
}
