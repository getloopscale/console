// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// M24 T8.1 — a jornada de operar guardrails, ponta a ponta pela tela.
//
// Cobre: catálogo → criar → testar (dry-run obrigatório) → salvar → aparecer no catálogo →
// remover com confirmação digitada → sumir. É o ÚNICO e2e do milestone: o resto da cobertura
// vive em lógica pura e teste de componente (ADR D4), seguindo o que o PostHog faz com feature
// flags — 71 casos de lógica e zero spec de browser para o ciclo de autoria.
//
// HONESTIDADE SOBRE O ESCOPO DESTE ARQUIVO: ele roda hermético, contra o Vite local com
// `VITE_USE_MOCKS=true`, como todo e2e deste repositório. Portanto prova a JORNADA DA INTERFACE
// — não prova que a guardrail criada bloqueia tráfego real no `/v1/guard` do serviço implantado.
// Essa metade do DoD do M24 é verificada contra o ambiente real e registrada como evidência de
// dogfood; um mock jamais poderia prová-la, e afirmar o contrário aqui seria teatro.

import { test, expect, type Page } from '@playwright/test';

/**
 * Nome namespaced por execução (EC-1 do edge-case review).
 *
 * Quando este spec roda contra um ambiente compartilhado, ele CRIA um objeto que passa a
 * bloquear tráfego. Um nome improvável e único por execução garante que duas execuções não
 * colidam e que nenhuma conversa humana case com o termo.
 */
const runId = `${Date.now()}`;
const NAME = `zzz-e2e-${runId}`;
const TERM = `zzz-termo-${runId}`;

async function gotoGuardrails(page: Page) {
  await page.goto('/trust/guardrails');
  await expect(page.getByRole('heading', { name: /guardrails/i })).toBeVisible();
}

/** Remove a guardrail do teste, se existir. Idempotente: roda antes E depois. */
async function cleanup(page: Page) {
  await gotoGuardrails(page);
  const row = page.getByRole('row').filter({ hasText: NAME });
  if ((await row.count()) === 0) return;

  await row.getByRole('button', { name: /remover/i }).click();
  await page.getByLabel('Confirmação').fill(NAME);
  await page.getByRole('button', { name: /remover guardrail/i }).click();
  await expect(page.getByRole('row').filter({ hasText: NAME })).toHaveCount(0);
}

test.describe('M24 — operar guardrails pelo dashboard', () => {
  // O afterEach não roda se o processo morrer; por isso limpamos sobras ANTES também.
  test.beforeEach(async ({ page }) => cleanup(page));
  test.afterEach(async ({ page }) => cleanup(page));

  test('o catálogo distingue o que é da plataforma do que é do workspace', async ({ page }) => {
    await gotoGuardrails(page);

    // Herdadas aparecem, e por TEXTO — não só por cor.
    await expect(page.getByText('Plataforma').first()).toBeVisible();

    // E não oferecem remoção: a ação não existe nessas linhas (ADR D2).
    const platformRow = page.getByRole('row').filter({ hasText: 'credential-mask' });
    await expect(platformRow.getByRole('button', { name: /remover/i })).toHaveCount(0);
  });

  test('não há caminho para salvar sem antes testar', async ({ page }) => {
    await page.goto('/trust/guardrails/new');

    await page.getByLabel('Nome').fill(NAME);
    await page.getByLabel('Termos a bloquear').fill(TERM);

    // A asserção que define o milestone: com rascunho válido e sem dry-run, o caminho de
    // gravação não existe. Nem desabilitado — ausente.
    await expect(page.getByRole('button', { name: /salvar/i })).toHaveCount(0);
  });

  test('criar → testar → salvar → aparecer → remover → sumir', async ({ page }) => {
    await page.goto('/trust/guardrails/new');

    await page.getByLabel('Nome').fill(NAME);
    await page.getByLabel('Termos a bloquear').fill(TERM);

    // Dry-run com uma amostra que a regra alcança: o veredito deve dizer que bloquearia.
    await page.getByLabel('Mensagem de exemplo').fill(`uma mensagem com ${TERM} dentro`);
    await page.getByRole('button', { name: /^testar$/i }).click();
    await expect(page.getByText(/seria bloqueada/i)).toBeVisible();

    // Só agora o caminho de salvar existe.
    await page.getByRole('button', { name: /salvar e ativar/i }).click();

    // Aparece no catálogo, marcada como do workspace.
    await expect(page.getByRole('heading', { name: /guardrails/i })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: NAME });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Deste workspace');

    // Remoção exige a frase digitada (DESIGN.md § 2.2).
    await row.getByRole('button', { name: /remover/i }).click();
    const confirm = page.getByRole('button', { name: /remover guardrail/i });
    await expect(confirm).toBeDisabled();

    await page.getByLabel('Confirmação').fill(NAME);
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByRole('row').filter({ hasText: NAME })).toHaveCount(0);
  });

  test('a auditoria mostra o que foi barrado, com o trecho redigido', async ({ page }) => {
    await page.goto('/trust/enforcement');

    await expect(page.getByRole('heading', { name: /enforcement/i })).toBeVisible();
    await expect(page.getByText('Bloqueado').first()).toBeVisible();
    // O marcador redigido é o que se vê; conteúdo bruto nunca chega a esta tela.
    await expect(page.getByText('sk_live_***')).toBeVisible();
  });
});
