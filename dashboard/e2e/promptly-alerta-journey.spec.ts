// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// M22 — definir um monitor de PROMPT pela tela, sem `curl`.
//
// A `v0.83.0` liberou `prompt_resolutions` no backend e o validou no `app-dev`, mas o `Select` de
// métrica desta tela era fechado sobre três opções: a capacidade existia e era inalcançável por
// quem não montasse o `POST` à mão (`usetheoai/theo-cloud#459`).
//
// A navegação é sempre por CLIQUE, a partir da raiz. Validar digitando o endereço usa o único
// caminho que o usuário real não tem — foi assim que quatro telas do `theo-trust` ficaram
// inalcançáveis com três rodadas de validação passando por cima.
//
// HONESTIDADE SOBRE O ESCOPO: roda hermético contra o Vite local com `VITE_USE_MOCKS=true`, como
// todo e2e deste repositório. Prova a JORNADA DA INTERFACE — não prova que a regra criada dispara
// contra o serviço implantado. Essa metade se verifica contra o ambiente e se registra como
// evidência de aceitação; afirmá-la aqui seria teatro.

import { test, expect } from '@playwright/test';

test.describe('M22 — o monitor de prompt pela tela', () => {
  test('do menu à regra de prompt criada, sem sair para o terminal', async ({ page }) => {
    await page.goto('/observability/alerts');

    // ---- A quarta métrica está oferecida ------------------------------------------------
    await page.getByRole('combobox', { name: /Metric/i }).click();
    await expect(page.getByRole('option', { name: /prompt/i })).toBeVisible();

    // ---- E as TRÊS de workspace seguem lá (regressão — a tela é compartilhada) -----------
    for (const rotulo of [/error rate/i, /cost/i, /latency/i]) {
      await expect(page.getByRole('option', { name: rotulo })).toBeVisible();
    }

    await page.getByRole('option', { name: /prompt/i }).click();

    // ---- O campo de prompt aparece SÓ agora ---------------------------------------------
    // O par inválido é irrepresentável no banco; um formulário que permite montá-lo só empurra a
    // recusa para depois do clique.
    const campoPrompt = page.getByLabel(/^Prompt$/i);
    await expect(campoPrompt).toBeVisible();

    // ---- Sem o nome do prompt, criar fica bloqueado --------------------------------------
    await page.getByLabel(/Rule name/i).fill('uso da saudação');
    await page.getByLabel(/Threshold/i).fill('3');
    await page.getByRole('combobox', { name: /Notify webhook/i }).click();
    await page.getByRole('option', { name: /prod hook/i }).click();
    await expect(page.getByRole('button', { name: /create rule/i })).toBeDisabled();

    // ---- Com o nome, cria ---------------------------------------------------------------
    await campoPrompt.fill('saudacao');
    await expect(page.getByRole('button', { name: /create rule/i })).toBeEnabled();
    await page.getByRole('button', { name: /create rule/i }).click();

    // A asserção é a LINHA na lista, não uma mensagem de sucesso — uma mensagem pode aparecer
    // sem nada ter sido gravado.
    await expect(page.getByRole('row').filter({ hasText: 'uso da saudação' })).toBeVisible();
  });

  test('a aba de produção do prompt leva ao monitor, carregando o nome', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^prompts$/i }).click();
    await expect(page.getByRole('button', { name: /^projects$/i })).toHaveCount(0);
    await page.getByRole('button', { name: /^catálogo$/i }).click();

    await page.getByRole('link', { name: 'saudacao', exact: true }).click();
    await page.getByRole('link', { name: 'Uso em produção' }).click();
    await expect(page).toHaveURL(/\/promptly\/saudacao\/producao$/);

    // O caminho existe, e carrega o nome — sem ele o operador chega numa tela vazia e digita de
    // novo, que é exatamente a fricção que este DoD remove.
    const caminho = page.getByRole('link', { name: /monitor/i });
    await expect(caminho).toBeVisible();
    await expect(caminho).toHaveAttribute('href', /prompt=saudacao/);
  });
});
