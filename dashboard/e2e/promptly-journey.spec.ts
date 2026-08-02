// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// M25 — a jornada de operar prompts, ponta a ponta PELA TELA.
//
// Cobre: raiz → menu → catálogo → detalhe → política vigente → promoção confirmada → o label
// passa a servir outra revisão. É o ÚNICO e2e do milestone: o resto da cobertura vive em lógica
// pura (`components/promptly/projections.ts`) e em teste de componente, seguindo o mesmo ADR do
// M24. Um e2e por tela não pega a costura, que é justamente onde esta jornada falha.
//
// A NAVEGAÇÃO É POR CLIQUE, A PARTIR DA RAIZ — nunca `page.goto('/promptly')`.
//
// Digitar a URL é o único caminho que o usuário real NÃO tem. No M23 quatro telas do trust
// ficaram inalcançáveis por falta de uma linha em `resolveActiveMenu`, e três rodadas de
// validação passaram por cima porque validavam digitando o endereço. Um e2e que faz `goto` na
// rota profunda reproduz exatamente aquela cegueira: fica verde com o menu quebrado.
//
// AS ASSERÇÕES SÃO SOBRE CONTEÚDO, NUNCA SOBRE STATUS HTTP. Uma tabela vazia servida com 200 é
// o modo de falha real de um BFF que devolve lista vazia quando a leitura falhou — e um teste
// que afirma "a página carregou" passa nele.
//
// HONESTIDADE SOBRE O ESCOPO: roda hermético contra o Vite local com `VITE_USE_MOCKS=true`, como
// todo e2e deste repositório. Prova a JORNADA DA INTERFACE contra o contrato medido do
// `theo-promptly` — não prova que o serviço implantado devolve estes corpos, nem que um agente em
// execução passa a resolver a revisão promovida. Essa metade se verifica contra o ambiente real
// e se registra como evidência; afirmá-la aqui seria teatro.

import { test, expect, type Page } from '@playwright/test';

/**
 * Chega ao catálogo CLICANDO a partir da raiz.
 *
 * Duas etapas, porque o menu tem duas: o item `Prompts` em Capabilities entra no submenu
 * (`drillsInto`), e o `Overview` dele abre a tela. Se qualquer uma das três peças do menu faltar,
 * é aqui que o teste morre — e morre no passo que o usuário de fato daria.
 */
async function navegarAteOCatalogoPeloMenu(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^prompts$/i }).click();
  // Esperar o submenu TROCAR antes de clicar no `Overview` dele. A raiz também tem um item
  // chamado "Overview": clicar cedo demais acerta o da raiz e a jornada continua em `/`, com a
  // navegação parecendo funcionar. O sinal de troca é a ausência de um item que só a raiz tem.
  await expect(page.getByRole('button', { name: /^projects$/i })).toHaveCount(0);
  await page.getByRole('button', { name: /^overview$/i }).click();
  await expect(page).toHaveURL(/\/promptly$/);
}

test.describe('M25 — operar prompts pelo dashboard', () => {
  test('a jornada inteira: do menu ao label servindo outra revisão', async ({ page }) => {
    await navegarAteOCatalogoPeloMenu(page);

    // ---- CATÁLOGO: conteúdo, não status --------------------------------------------------
    await expect(page.getByText('saudacao')).toBeVisible();
    await expect(page.getByText('despedida')).toBeVisible();

    // A coluna que responde "isto está servindo produção?" — a pergunta que traz o operador aqui.
    await expect(page.getByText('prod → v1')).toBeVisible();
    // E o prompt que não serve ambiente algum diz isso, em vez de deixar a célula vazia: célula
    // vazia é indistinguível de dado que não carregou.
    await expect(page.getByText('nenhum')).toBeVisible();

    // ---- DETALHE: alcançado pelo NOME, que é o caminho da lista ---------------------------
    await page.getByRole('link', { name: 'saudacao' }).click();
    await expect(page).toHaveURL(/\/promptly\/saudacao$/);

    // O trecho da revisão — o suficiente para reconhecê-la. O corpo inteiro é editor, e editor
    // está fora deste milestone por decisão registrada.
    await expect(page.getByText(/sou o assistente/)).toBeVisible();
    await expect(page.getByText('prod → v1')).toBeVisible();

    // ---- A POLÍTICA, ANTES DO ATO --------------------------------------------------------
    // Este prompt não tem política: a promoção é livre, e a tela precisa DIZER isso. Silêncio
    // aqui seria indistinguível de "não consegui ler a regra".
    await page.getByRole('button', { name: /Promover prod para a revisão v3/i }).click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByText(/promoção é livre/i)).toBeVisible();

    // ---- A CONSEQUÊNCIA, NOMEADA ---------------------------------------------------------
    // Não "o item será alterado": QUAL revisão deixa de servir o label. O v1 vem de `/labels`.
    await expect(dialogo.getByText(/deixa de servir a v1/i)).toBeVisible();
    await expect(dialogo.getByText(/passa a servir a v3/i)).toBeVisible();

    // ---- A PROMOÇÃO, ATRÁS DA FRASE DIGITADA ---------------------------------------------
    await dialogo.getByRole('textbox').fill('prod');
    await dialogo.getByRole('button', { name: /^Promover$/i }).click();

    // ---- O ORÁCULO É O ESTADO, NÃO A RESPOSTA --------------------------------------------
    // O que prova a promoção é o ponteiro ter mudado na tela: um 200 do servidor com o label
    // parado seria exatamente o defeito que este passo existe para pegar.
    await expect(page.getByText('prod → v3')).toBeVisible();
    await expect(page.getByText('prod → v1')).toHaveCount(0);
  });

  test('a recusa da política chega ao operador com o motivo do serviço', async ({ page }) => {
    // O par que discrimina o teste acima. `saudacao/staging` TEM política, e o serviço recusa com
    // os números. Sem este caso o e2e provaria só o caminho feliz — e a mensagem tipada poderia
    // estar sendo colapsada em "erro" genérico sem nada acusar.
    await navegarAteOCatalogoPeloMenu(page);
    await page.getByRole('link', { name: 'saudacao' }).click();

    await page.getByRole('button', { name: /Promover staging para a revisão v3/i }).click();
    const dialogo = page.getByRole('dialog');

    // A regra vigente é exibida ANTES do ato — é a razão de o GET de políticas existir neste
    // milestone em vez de ficar para depois.
    await expect(dialogo.getByText(/score mínimo de 0\.8/i)).toBeVisible();

    await dialogo.getByRole('textbox').fill('staging');
    await dialogo.getByRole('button', { name: /^Promover$/i }).click();

    // O TEXTO do serviço, com os números que dizem POR QUE. Sem eles o operador vê "erro" e
    // tenta de novo igual.
    await expect(page.getByText(/melhor execução desta revisão obteve 0\.41/i)).toBeVisible();
    // E o ponteiro NÃO se moveu: a recusa foi honrada, não apenas exibida.
    await expect(page.getByText('staging → v2')).toBeVisible();
  });

  test('o prompt sem label algum diz isso, em vez de oferecer promoção às cegas', async ({ page }) => {
    // A frase MUDA com o dado. Sem label não há revisão que saia, e a tela não finge que há.
    await navegarAteOCatalogoPeloMenu(page);
    await page.getByRole('link', { name: 'despedida' }).click();
    await expect(page).toHaveURL(/\/promptly\/despedida$/);

    await expect(page.getByText(/Nenhum label de ambiente aponta para este prompt/i)).toBeVisible();
  });
});
