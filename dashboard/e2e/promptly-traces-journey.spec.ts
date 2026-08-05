// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// M23 — o caminho da aba de um prompt até as resoluções individuais dele.
//
// A aba *Uso em produção* mostra um agregado. Quando o número surpreende, não havia para onde ir:
// os spans `prompt.resolve` já existiam, já estavam indexados por `prompt.id` no `theo-lens`, e a
// única forma de chegar neles era digitar a URL (`usetheoai/theo-cloud#463`).
//
// POR QUE ESTE SPEC EXISTE, e por que ele afirma no DESTINO:
//
// O `/review` do M22 achou um BLOCKER em que o produtor escrevia `?prompt=` e a tela de destino
// NUNCA lia o parâmetro. Todos os testes de unidade estavam verdes — porque afirmavam o `href` do
// produtor e chamavam aquilo de jornada. O peer maduro (Langfuse) também não testa o link
// equivalente: 0 dos 236 arquivos de teste dele o mencionam. Isso é evidência de que o buraco é
// COMUM, não de que é tolerável.
//
// A navegação é por CLIQUE, a partir da raiz. Chegar digitando o endereço usa o único caminho que
// o usuário real não tem.
//
// HONESTIDADE SOBRE O ESCOPO: roda hermético contra o Vite local com `VITE_USE_MOCKS=true`, como
// todo e2e deste repositório. Prova a JORNADA DA INTERFACE — que o produtor constrói o endereço e
// que o consumidor o honra. Não prova que o serviço implantado devolve os spans certos; essa
// metade se verifica contra o ambiente e se registra como evidência de aceitação.

import { test, expect, type Page } from '@playwright/test';

/**
 * Chega ao catálogo CLICANDO a partir da raiz — o helper canônico de `promptly-journey.spec.ts`.
 *
 * São duas etapas porque o menu tem duas: o item `Prompts` entra no submenu (`drillsInto`) e o
 * item dele abre a tela. A espera no meio existe porque a raiz tem itens de mesmo nome: clicar
 * cedo demais acerta o da raiz e a jornada segue em `/`, com a navegação parecendo funcionar.
 */
async function navegarAteOCatalogoPeloMenu(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^prompts$/i }).click();
  await expect(page.getByRole('button', { name: /^projects$/i })).toHaveCount(0);
  await page.getByRole('button', { name: /^catálogo$/i }).click();
  await expect(page).toHaveURL(/\/promptly\/catalogo$/);
}

test.describe('M23 — do número na aba até as resoluções que o produziram', () => {
  test('do catálogo ao explorador filtrado, sem digitar endereço', async ({ page }) => {
    await navegarAteOCatalogoPeloMenu(page);

    // ---- Abrir um prompt e a aba de uso, clicando --------------------------------------
    await page.getByRole('link', { name: 'saudacao', exact: true }).click();
    await page.getByRole('link', { name: 'Uso em produção' }).click();

    // ---- O caminho existe, e diz ao operador o que vai encontrar -----------------------
    const caminho = page.getByRole('link', { name: /resolu/i });
    await expect(caminho).toBeVisible();

    await caminho.click();

    // ---- O DESTINO consumiu o parâmetro ------------------------------------------------
    // Esta é a asserção que faltava no M22. Um destino que ignora o parâmetro chega aqui com a
    // URL certa e a lista errada — por isso o que se afirma abaixo é o CHIP e as LINHAS, nunca
    // apenas o endereço.
    await expect(page).toHaveURL(/\/observability\/traces\?/);
    await expect(page).toHaveURL(/span_query=attr%3Aprompt\.id%3Dsaudacao/);

    // O chip de filtro nomeia o atributo — prova de que o destino leu e aplicou.
    await expect(page.getByText(/PROMPT\.ID=SAUDACAO/i)).toBeVisible();

    // E a listagem mostra resoluções, e nada que não seja resolução. O mock devolve uma lista
    // DIFERENTE sem filtro (com um `chat.completion`); se o destino ignorasse o parâmetro, essa
    // linha apareceria e a asserção seguinte cairia.
    await expect(page.getByText('prompt.resolve').first()).toBeVisible();
    await expect(page.getByText('chat.completion')).toHaveCount(0);
  });
});
