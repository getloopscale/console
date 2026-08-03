// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// M12 — a jornada de AUTORAR e COMPARAR, ponta a ponta PELA TELA.
//
// Complementa o e2e do M25 (catálogo → detalhe → promover) com a metade que faltava para o
// ciclo fechar: criar uma revisão e entender o que mudou entre duas. É o ÚNICO e2e do
// milestone — o resto da cobertura vive em lógica pura, testada sem browser.
//
// A NAVEGAÇÃO É POR CLIQUE, A PARTIR DA RAIZ. Digitar a URL é o único caminho que o usuário real
// não tem; um e2e que faz `goto` na rota profunda fica verde com o menu quebrado, que é
// exatamente o defeito que este milestone tinha de fechar.
//
// AS ASSERÇÕES SÃO SOBRE CONTEÚDO, NUNCA SOBRE STATUS.
//
// NENHUM CONTROLE FATURÁVEL É CLICADO. Derivado por varredura do marcador `ModelInvoker` no
// produto: a única rota que invoca modelo é `POST /evaluations/runs`, e ela não aparece em
// nenhuma tela desta jornada. O preview desta tela é substituição LOCAL — é o que torna esse
// eixo fechado por construção, e não por disciplina de quem escreve o teste.
//
// ESCOPO, dito por inteiro: roda hermético contra o Vite local com `VITE_USE_MOCKS=true`. Prova
// a jornada da INTERFACE contra o contrato medido do `theo-promptly` — não prova que o serviço
// implantado devolve estes corpos. Essa metade se verifica em `/acceptance`, contra o build da
// tag; afirmá-la aqui seria teatro.

import { test, expect, type Page } from '@playwright/test';

/** Chega ao catálogo CLICANDO — as duas metades do menu, como o usuário faz. */
async function navegarAteOCatalogoPeloMenu(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^prompts$/i }).click();
  // O submenu tem de TROCAR antes do clique seguinte: a raiz também tem "Overview", e clicar
  // cedo demais acerta o dela com a navegação parecendo funcionar.
  await expect(page.getByRole('button', { name: /^projects$/i })).toHaveCount(0);
  await page.getByRole('button', { name: /^overview$/i }).click();
  await expect(page).toHaveURL(/\/promptly$/);
}

test.describe('M12 — autorar e comparar prompts pelo dashboard', () => {
  test('a jornada inteira: menu → nova revisão → preview → salvar → comparar', async ({ page }) => {
    await navegarAteOCatalogoPeloMenu(page);

    // ---- A AUTORIA É ALCANÇÁVEL PELO MENU -------------------------------------------------
    // Este é o passo que o milestone existe para provar. Se o item de submenu faltar, morre
    // aqui — no passo que o usuário de fato daria, e não numa asserção sobre a URL.
    await page.getByRole('link', { name: /nova revisão/i }).first().click();
    await expect(page).toHaveURL(/\/promptly\/new$/);

    // ---- A PERMANÊNCIA É DITA ANTES DE GRAVAR ---------------------------------------------
    // Não há DELETE no produto. Descobrir isso depois de salvar é tarde demais para agir.
    await expect(page.getByText(/imutáveis/i)).toBeVisible();

    // ---- O PREVIEW RENDERIZA SEM CHAMAR MODELO --------------------------------------------
    await page.getByLabel('Nome do prompt').fill('boas-vindas');
    await page.getByLabel('Texto do prompt').fill('Olá {{nome}}, bem-vindo ao {{produto}}.');

    // Campo em branco deixa o marcador À VISTA — o buraco não pode passar despercebido.
    await expect(page.getByTestId('promptly-preview')).toContainText('{{nome}}');

    await page.getByLabel('nome', { exact: true }).fill('Paulo');
    await expect(page.getByTestId('promptly-preview')).toContainText('Olá Paulo');
    // E o que segue em branco continua marcado: o preview mostra o estado real, não um otimista.
    await expect(page.getByTestId('promptly-preview')).toContainText('{{produto}}');

    // ---- SALVAR LEVA AO DETALHE DO PROMPT CRIADO ------------------------------------------
    await page.getByRole('button', { name: /criar revisão/i }).click();
    await expect(page).toHaveURL(/\/promptly\/boas-vindas$/);

    // ---- COMPARAR: alcançado a partir do prompt, não do menu -------------------------------
    // Comparar é POR PROMPT — uma entrada de menu exigiria um nome que o menu não tem.
    await navegarAteOCatalogoPeloMenu(page);
    await page.getByRole('link', { name: 'saudacao' }).click();
    await page.getByRole('link', { name: /comparar/i }).click();
    await expect(page).toHaveURL(/\/promptly\/saudacao\/diff$/);

    // A tela precisa ter TERMINADO de carregar antes de qualquer contagem. `count()` NÃO
    // auto-espera — foi assim que a primeira versão deste teste falhou contra uma tela correta,
    // medindo o fallback de Suspense em vez do conteúdo.
    await expect(page.getByRole('heading', { name: /diferenças/i })).toBeVisible();

    // O conteúdo do diff, não o status da página: a tela mostra alguma diferença OU declara que
    // não há. As duas são respostas; uma página em branco não é nenhuma.
    const temDiff = await page.getByTestId('promptly-diff').count();
    const temIguais = await page.getByTestId('promptly-diff-identical').count();
    expect(temDiff + temIguais).toBeGreaterThan(0);
  });

  // O par "vazio oferece criar / vazio-por-FALHA não oferece" NÃO está aqui, e a ausência é
  // decisão medida: os mocks deste repositório interceptam no `fetch` da aplicação, antes da
  // camada de rede, então `page.route` nunca vê a chamada e o teste ficaria VERDE sem exercitar
  // nada — um guard que não distingue os dois estados é pior que nenhum. O par vive em
  // `src/pages/promptly.test.tsx`, onde a falha é injetável de verdade. E o milestone pede UM
  // e2e da jornada, não um por asserção.
});
