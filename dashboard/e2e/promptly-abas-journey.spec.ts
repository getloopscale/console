// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// M21 — a jornada das QUATRO ABAS, ponta a ponta pela tela.
//
// Cobre: menu → catálogo → prompt → cada aba por clique → COPIAR o trecho de consumo → promover a
// partir de uma aba que não é a de ambientes, e ver a confirmação abrir sem trocar de rota. É o
// DoD-1 (as quatro perguntas, e nenhum endereço perdido), o DoD-2 (o trecho é copiável e aponta
// para este prompt) e o DoD-3 (a AÇÃO de promover, não só o cartão).
//
// O `/review` classificou a versão anterior como falso-verde em dois pontos: ela dizia cobrir a
// promoção e só verificava cabeçalhos, e dizia cobrir o consumo e só verificava um `<pre>`. Um
// título de teste que promete mais do que a asserção entrega é pior que ausência de teste.
//
// A navegação é sempre por CLIQUE, a partir da raiz. Validar digitando o endereço usa o único
// caminho que o usuário real não tem — foi assim que quatro telas do `theo-trust` ficaram
// inalcançáveis com três rodadas de validação passando por cima.
//
// HONESTIDADE SOBRE O ESCOPO: roda hermético contra o Vite local com `VITE_USE_MOCKS=true`, como
// todo e2e deste repositório. Prova a JORNADA DA INTERFACE — não prova que o trecho copiado resolve
// um prompt no serviço implantado. Essa metade se verifica contra o ambiente e se registra como
// evidência de aceitação; afirmá-la aqui seria teatro.

import { test, expect, type Page } from '@playwright/test';

async function navegarAteOCatalogoPeloMenu(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^prompts$/i }).click();
  // Esperar o submenu TROCAR antes de clicar no item dele — a raiz tem itens de mesmo nome, e
  // clicar cedo demais acerta o da raiz com a navegação parecendo funcionar.
  await expect(page.getByRole('button', { name: /^projects$/i })).toHaveCount(0);
  await page.getByRole('button', { name: /^catálogo$/i }).click();
  await expect(page).toHaveURL(/\/promptly\/catalogo$/);
}

test.describe('M21 — as quatro perguntas do detalhe', () => {
  test('do menu às quatro abas, ao trecho que se copia, e à promoção sem sair', async ({ page }) => {
    await navegarAteOCatalogoPeloMenu(page);

    // ---- O endereço que já circulava (DoD-1) ---------------------------------------------
    // O link do catálogo aponta para `/promptly/:name`, sem sufixo. Ele continua resolvendo, e
    // abre a aba de conteúdo — quebrá-lo trocaria uma tela melhor por caminhos mortos.
    await page.getByRole('link', { name: 'saudacao', exact: true }).click();
    await expect(page).toHaveURL(/\/promptly\/saudacao$/);
    await expect(page.getByRole('link', { name: 'Conteúdo' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { name: 'Revisões' })).toBeVisible();

    // ---- Cada aba responde a SUA pergunta -------------------------------------------------
    await page.getByRole('link', { name: 'Config' }).click();
    await expect(page).toHaveURL(/\/promptly\/saudacao\/config$/);
    await expect(page.getByRole('heading', { name: 'Variáveis exigidas' })).toBeVisible();
    // E não mostra o que é de outra aba — sem isto, um recorte que renderizasse tudo em toda aba
    // passaria, e a tela continuaria sendo o scroll único com uma barra decorativa em cima.
    await expect(page.getByRole('heading', { name: 'Revisões' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Uso em produção' }).click();
    await expect(page).toHaveURL(/\/promptly\/saudacao\/producao$/);
    await expect(page.getByRole('heading', { name: 'Uso por revisão' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quem referencia este prompt' })).toBeVisible();

    // ---- A aba de consumo entrega código (DoD-2) -----------------------------------------
    await page.getByRole('link', { name: 'Como consumir' }).click();
    await expect(page).toHaveURL(/\/promptly\/saudacao\/consumo$/);

    for (const rotulo of ['SDK (TypeScript)', 'REST (curl)', 'MCP']) {
      await expect(page.getByRole('heading', { name: rotulo })).toBeVisible();
    }
    // O trecho aponta para ESTE prompt — é o que separa "código de exemplo" de "código que roda".
    const trechos = page.locator('pre');
    await expect(trechos.first()).toContainText('saudacao');
    // E não carrega credencial: um trecho é feito para ser copiado.
    await expect(trechos.first()).not.toContainText('promptly_live_');

    // ---- Recarregar mantém o lugar (ADR-1: a aba é rota, não estado) ----------------------
    await page.reload();
    await expect(page.getByRole('link', { name: 'Como consumir' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // ---- DoD-2: o botão de copiar existe e COPIA ------------------------------------------
    // A versão anterior deste spec verificava só o `<pre>`, e o `/review` classificou isso como
    // falso-verde: o DoD diz "copiar o trecho e executá-lo", e um bloco visível sem botão que
    // funcione não cumpre a primeira metade.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: /Copiar o trecho REST/ }).click();
    await expect(page.getByRole('button', { name: /Copiar o trecho REST/ })).toHaveText('Copiado');
    const copiado = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiado).toContain('curl');
    expect(copiado).toContain('saudacao');

    // ---- DoD-3: promover a partir de uma aba que NÃO é a de ambientes ---------------------
    // A AÇÃO, não só o cartão. O `/review` mediu que a versão anterior deste bloco verificava dois
    // cabeçalhos e passava com ZERO botões de promoção — a ação inteira vivia na aba de conteúdo,
    // e três lugares (comentário, teste e CHANGELOG) afirmavam o contrário.
    await expect(page.getByRole('heading', { name: 'Ambientes' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tags' })).toBeVisible();
    const promover = page.getByRole('button', { name: /^Promover prod para a última revisão/ });
    await expect(promover).toBeVisible();

    // E ela ABRE a confirmação, sem sair da aba de consumo.
    await promover.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL(/\/promptly\/saudacao\/consumo$/);
    await page.keyboard.press('Escape');

    // ---- E o caminho de volta existe ------------------------------------------------------
    await page.getByRole('link', { name: 'Conteúdo' }).click();
    await expect(page).toHaveURL(/\/promptly\/saudacao$/);
    await expect(page.getByRole('heading', { name: 'Revisões' })).toBeVisible();
  });
});
