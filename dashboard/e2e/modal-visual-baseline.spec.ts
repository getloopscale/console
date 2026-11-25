import { test, expect } from '@playwright/test';

/**
 * B-106 — a caixa do `AppModal` passa a ter instrumento.
 *
 * ## O custo medido do status quo, que é o que justifica este arquivo
 *
 * A consolidação de modais (`modal-primitive-consolidation`) trocou dois primitivos por um.
 * A revisão visual que o plano exigia — "cada modal migrado foi aberto e comparado com o
 * estado anterior" — cobriu **3 de 14**, e a amostra falhou do jeito exato que amostras
 * falham: mediu `max-w-*` em dois viewports e a prosa concluiu **paridade de aparência**.
 * Quatro horas depois, uma medição independente achou `gap-3` (primitivo antigo) contra
 * `gap-4` (o que ficou): **16 modais ficaram ~8 px mais altos**, mudança visível ao usuário
 * que a revisão visual não pegou e que o ADR `D4` teve de retratar.
 *
 * Antes da consolidação, mudar espaçamento tinha raio de UM arquivo. Hoje, com ~30 modais
 * saindo do mesmo primitivo, uma linha na caixa do `AppModal` altera trinta telas de uma vez.
 * É esse delta — a padronização funcionando — que torna o instrumento obrigatório, e não a
 * existência de modais.
 *
 * ## Por que reusar o mecanismo em vez de escolher um
 *
 * O repositório já faz regressão visual: `toHaveScreenshot()` com linhas de base
 * versionadas, gravadas na imagem do runner (ver `dashboard-m12-fase-a-bundle-grep-migration
 * .spec.ts` e o commit `1d8a26c8`). Escolher uma ferramenta nova para isto seria reinventar
 * o que já está instalado e funcionando — degrau 4 da ladder de parcimônia.
 *
 * ## O que é fotografado, e por quê só o painel
 *
 * A captura é do `[role="dialog"]`, não da página. Uma foto de página inteira reprova por
 * qualquer coisa atrás do modal — um item novo na barra lateral, um número de uso que mudou
 * — e um instrumento que dispara pelo motivo errado é desligado em duas semanas. O que este
 * arquivo protege é a CAIXA: largura, espaçamento entre regiões, tipografia do título, o
 * rodapé.
 *
 * Dois modais, e não um: o `PlanLimitUpgradeModal` usa o `AppModal` diretamente, e o
 * `ConfirmDialog` o compõe. São caminhos de composição diferentes, e o segundo é o que 29
 * telas consomem.
 */
test.describe('Caixa do AppModal — linha de base visual', () => {
  test.skip(
    !process.env.CI,
    'referência de imagem gravada no ambiente do CI (playwright:v1.60.0-noble); ' +
      'fora dele a diferença de fontes reprova uma tela correta',
  );

  const ROTA = '/projects/acme-web/environments';

  test('AppModal direto — o painel de limite de plano', async ({ page }) => {
    await page.goto(ROTA);
    // Esperar a MONTAGEM antes de disparar: `page.goto` resolve no `load` do documento, que
    // acontece antes de o React registrar o listener de `window`. Ver o comentário longo em
    // `j10-environments.spec.ts`, onde essa corrida foi medida.
    await expect(
      page.getByRole('navigation').or(page.locator('aside')).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Detalhe FIXO: uma mensagem vinda do servidor mudaria a foto sem a caixa ter mudado.
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('loopscale:plan-limit', {
          detail: {
            code: 'PLAN_LIMIT_EXCEEDED',
            message: 'You hit the environment cap on Starter',
            resource: 'environments',
            current_plan: 'starter',
          },
        }),
      );
    });

    const painel = page.getByRole('dialog');
    await expect(painel).toBeVisible({ timeout: 5_000 });
    await expect(painel).toHaveScreenshot('appmodal-plan-limit.png', { maxDiffPixels: 200 });
  });

  test('AppModal composto — a confirmação destrutiva que 29 telas usam', async ({ page }) => {
    await page.goto(ROTA);
    await page.getByRole('button', { name: /delete staging/i }).click();

    const painel = page.getByRole('dialog');
    await expect(painel).toBeVisible({ timeout: 5_000 });
    // Assentar no campo de digitar-para-confirmar: sem isto a foto pode sair no quadro em que
    // o painel já existe e o corpo ainda não.
    await expect(page.getByLabel(/type/i).first()).toBeVisible();
    await expect(painel).toHaveScreenshot('appmodal-confirm-destructive.png', {
      maxDiffPixels: 200,
    });
  });
});
