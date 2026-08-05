// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// M20 — a jornada da COMPOSIÇÃO, ponta a ponta pela tela.
//
// Cobre: menu → catálogo → prompt que compõe → alternar entre "como foi escrito" e "resolvido" →
// seguir para o prompt referenciado → ver quem depende dele → voltar. É o par que o milestone exige
// nos dois sentidos: *"o que eu componho"* e *"quem me compõe"*.
//
// A navegação é sempre por CLIQUE, a partir da raiz. A lição custou o M20 do `theo-trust`: quatro
// telas foram declaradas no submenu, nunca abriram por falta de uma linha em `resolveActiveMenu`, e
// três rodadas de validação passaram por cima — porque eu validava digitando a URL, que é o único
// caminho que o usuário real não tem.
//
// HONESTIDADE SOBRE O ESCOPO: roda hermético contra o Vite local com `VITE_USE_MOCKS=true`, como
// todo e2e deste repositório. Prova a JORNADA DA INTERFACE contra o contrato medido do
// `theo-promptly` — não prova que o serviço implantado resolve a composição, nem que o modelo
// recebe o texto resolvido. Essa metade se verifica contra o ambiente real e se registra como
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

test.describe('M20 — composição pelo dashboard', () => {
  test('do menu ao par de textos, e de volta por quem referencia', async ({ page }) => {
    await navegarAteOCatalogoPeloMenu(page);

    // ---- O prompt que COMPÕE, alcançado pelo nome na lista -------------------------------
    await page.getByRole('link', { name: 'atendimento', exact: true }).click();
    await expect(page).toHaveURL(/\/promptly\/atendimento$/);

    // ---- DoD-2: os dois textos -----------------------------------------------------------
    await expect(page.getByRole('heading', { name: 'Texto do prompt' })).toBeVisible();

    // As asserções são ESCOPADAS ao cartão, e não à página: a tabela de revisões também mostra o
    // conteúdo da revisão, então `getByText` na página casa dois elementos. Afirmar sobre a página
    // inteira aqui daria um verde que vem da tabela — e o cartão poderia estar renderizando
    // qualquer coisa.
    const painel = page.locator('pre').first();

    // Começa em "como foi escrito", e o marcador está VISÍVEL. É o que torna a composição
    // depurável: sem ver o marcador, o operador não sabe que há composição para depurar.
    await expect(painel).toContainText('@@@promptly:name=politica');

    await page.getByRole('button', { name: /^Resolvido$/ }).click();

    // Agora o texto do referenciado está lá, e o marcador NÃO. As duas asserções juntas: sem a
    // segunda, um "resolvido" que apenas concatenasse passaria.
    await expect(painel).toContainText('Seja sempre cordial e nunca prometa prazo');
    await expect(painel).not.toContainText('@@@promptly:name=politica');

    // E o caminho de VOLTA existe: alternar não é uma porta de mão única.
    await page.getByRole('button', { name: /^Como foi escrito$/ }).click();
    await expect(painel).toContainText('@@@promptly:name=politica');

    // ---- DoD-4: quem me referencia, do outro lado ----------------------------------------
    // M21 — a lista migrou para a aba de PRODUÇÃO: "quem quebra se eu mexer aqui" é pergunta sobre
    // o uso, não sobre o texto. A jornada segue o caminho do usuário e CLICA na aba.
    await page.getByRole('link', { name: 'Uso em produção' }).click();
    // Este prompt não é referenciado por ninguém — e a tela DIZ isso, em vez de deixar vazio.
    // Espaço em branco lê-se como "não carregou", que é outro estado.
    await expect(page.getByText(/Nenhum prompt referencia este/)).toBeVisible();

    // Segue para o prompt REFERENCIADO. O caminho natural do operador que quer mudar a política.
    await navegarAteOCatalogoPeloMenu(page);
    await page.getByRole('link', { name: 'politica', exact: true }).click();
    await expect(page).toHaveURL(/\/promptly\/politica$/);

    // Aqui a lista tem conteúdo — e é a informação que muda a decisão de promover.
    await page.getByRole('link', { name: 'Uso em produção' }).click();
    await expect(page.getByRole('heading', { name: 'Quem referencia este prompt' })).toBeVisible();
    const dependente = page.getByRole('link', { name: 'atendimento', exact: true });
    await expect(dependente).toBeVisible();
    // O `via` diz se uma promoção move esta aresta. A referência é por VERSÃO, logo é fixa.
    await expect(page.getByText(/por versão \(fixa\)/)).toBeVisible();

    // A `politica` não compõe nada, então o alternador NÃO aparece — dois textos idênticos lado a
    // lado seriam ruído, e a travessia do grafo custaria por nada.
    await expect(page.getByRole('heading', { name: 'Texto do prompt' })).toHaveCount(0);

    // ---- O ciclo se fecha: o dependente leva de volta ao prompt que compõe ----------------
    await dependente.click();
    await expect(page).toHaveURL(/\/promptly\/atendimento$/);
    await expect(page.getByRole('heading', { name: 'Texto do prompt' })).toBeVisible();
  });
});
