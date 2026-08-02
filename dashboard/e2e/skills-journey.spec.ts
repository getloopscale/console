// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// M26 — a jornada do registro de skills, ponta a ponta PELA TELA.
//
// Cobre: raiz → menu → acervo → detalhe → instrução resolvida → versões e canais. É o ÚNICO e2e
// do milestone: o resto da cobertura vive em lógica pura (`components/skills/projections.ts`) e
// em teste de componente, seguindo o mesmo ADR do M24. Um e2e por tela não pega a costura, que é
// justamente onde esta jornada já falhou antes.
//
// A NAVEGAÇÃO É POR CLIQUE, A PARTIR DA RAIZ — nunca `page.goto('/skills')`.
//
// Isso não é preciosismo de estilo: digitar a URL é o único caminho que o usuário real NÃO tem.
// No M23 quatro telas do trust ficaram inalcançáveis por falta de uma linha em
// `resolveActiveMenu`, e três rodadas de validação passaram por cima porque validavam digitando
// o endereço. Um e2e que faz `goto` na rota profunda reproduz exatamente aquela cegueira: ele
// fica verde com o menu quebrado.
//
// HONESTIDADE SOBRE O ESCOPO: roda hermético contra o Vite local com `VITE_USE_MOCKS=true`, como
// todo e2e deste repositório. Prova a JORNADA DA INTERFACE contra o contrato medido do
// `theo-skills` — não prova que o registro implantado devolve estes corpos. Essa metade se
// verifica contra o ambiente real e se registra como evidência; afirmá-la aqui seria teatro.

import { test, expect, type Page } from '@playwright/test';

/**
 * Chega ao acervo CLICANDO a partir da raiz.
 *
 * Duas etapas, porque o menu tem duas: o item `Skills` em Capabilities entra no submenu
 * (`drillsInto`), e o `Overview` dele abre a tela. Se qualquer uma das três peças do menu faltar,
 * é aqui que o teste morre — e morre no passo que o usuário de fato daria.
 */
async function navegarAteOAcervoPeloMenu(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^skills$/i }).click();
  await page.getByRole('button', { name: /^overview$/i }).click();
  await expect(page).toHaveURL(/\/skills$/);
}

test.describe('M26 — navegar o registro de skills pelo dashboard', () => {
  test('a jornada inteira, do menu à instrução resolvida e aos canais', async ({ page }) => {
    await navegarAteOAcervoPeloMenu(page);

    // ---- ACERVO: conteúdo, não status HTTP ----------------------------------------------
    // Afirmar "a página carregou" deixaria passar uma tabela vazia servida com 200, que é o
    // modo de falha real de um BFF que devolve `{items:[]}` quando a leitura falhou.
    await expect(page.getByRole('heading', { name: /skills/i }).first()).toBeVisible();
    await expect(page.getByText('Revisar pull request')).toBeVisible();
    await expect(page.getByText('Lê o diff e aponta riscos antes do merge.')).toBeVisible();

    // A distinção de execução é TEXTO, não só cor — precisa sobreviver a daltonismo e impressão.
    await expect(page.getByText('local', { exact: true })).toBeVisible();

    // ---- DETALHE: alcançado pelo nome, que é o caminho da lista --------------------------
    await page.getByRole('link', { name: 'Revisar pull request' }).click();
    await expect(page).toHaveURL(/\/skills\/sk_ordering$/);
    await expect(page.getByText('sk_ordering')).toBeVisible();

    // ---- INSTRUÇÃO RESOLVIDA: o fim da jornada de leitura --------------------------------
    // O TEXTO, não a presença do bloco: é ele que um agente carregaria, e é lendo-o que o
    // operador decide se a revisão vigente é a que quer promover.
    await expect(page.getByText(/Leia o diff inteiro antes de comentar/)).toBeVisible();
    await expect(page.getByText(/deste workspace/)).toBeVisible();

    // ---- VERSÕES E CANAIS ---------------------------------------------------------------
    await page.getByRole('link', { name: /ver versões e canais/i }).click();
    await expect(page).toHaveURL(/\/skills\/sk_ordering\/versions$/);

    const linhas = page.getByRole('row');
    await expect(linhas.filter({ hasText: '1.10.0' })).toHaveCount(1);
    await expect(linhas.filter({ hasText: '1.2.0' })).toHaveCount(1);
    await expect(linhas.filter({ hasText: '1.0.0' })).toHaveCount(1);

    // A versão que canal nenhum serve PERMANECE na lista: é a candidata a ser promovida, e
    // filtrá-la tiraria da tela o insumo da única ação da jornada.
    await expect(linhas.filter({ hasText: '1.10.0' })).toContainText('—');

    // O canal aparece na linha da revisão que ele de fato serve — `stable` está em `rev_a`,
    // que é a `1.0.0`, e NÃO na versão mais nova. Uma projeção que casasse "canal com a última
    // versão" passaria num teste de presença e mentiria exatamente aqui.
    await expect(linhas.filter({ hasText: '1.0.0' })).toContainText('stable');
    await expect(linhas.filter({ hasText: '1.10.0' })).not.toContainText('stable');
  });

  test('o submenu de skills continua aberto dentro de uma skill', async ({ page }) => {
    // Se a resolução do menu casasse só o caminho exato, abrir uma skill fecharia o menu que
    // levou até ela — e o operador perderia a navegação no instante em que a usou.
    await navegarAteOAcervoPeloMenu(page);
    await page.getByRole('link', { name: 'Revisar pull request' }).click();

    // Itens que só a RAIZ tem: se eles reaparecem, o menu voltou para a raiz.
    await expect(page.getByRole('button', { name: /^domains$/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^overview$/i })).toBeVisible();
  });

  test('a recusa tipada do registro chega como diagnóstico, não como "erro ao carregar"', async ({
    page,
  }) => {
    // Uma skill `local` traz script: o registro RECUSA a instrução com 422 tipado, e essa recusa
    // é informação sobre a NATUREZA da skill. Renderizada como falha genérica, o operador
    // investigaria o sistema em vez de entender a skill — e é assim que um 4xx tipado colapsado
    // em 502 vira defeito de interface. É o caso que o BFF preserva de propósito.
    await navegarAteOAcervoPeloMenu(page);
    await page.getByRole('link', { name: 'Preparar ambiente local' }).click();

    await expect(page.getByText(/roda na máquina do cliente/i)).toBeVisible();
    await expect(page.getByText(/theoskill install|instale-a pela CLI/i)).toBeVisible();
  });
});
