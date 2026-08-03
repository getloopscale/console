// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// M14 T5.1 — a jornada do playground, ponta a ponta pela tela.
//
// Cobre: raiz → capacidade (pelo MENU) → catálogo (pelo MENU) → prompt → playground → preencher →
// salvar. É o ÚNICO e2e do milestone; o resto da cobertura vive em lógica pura (22 casos) e teste
// de componente (15), seguindo o que o M12 e o M13 já fizeram.
//
// POR QUE NAVEGA POR CLIQUE. No `theo-trust` (M23) quatro telas foram declaradas no submenu e
// NUNCA abriram, porque faltava a linha em `resolveActiveMenu` — e três rodadas de validação
// passaram por cima, porque validavam digitando a URL, que é o único caminho que o usuário real
// não tem. Por isso há UM único `page.goto`, na raiz.
//
// **ESTE SPEC NÃO CLICA EM "RODAR", E ISSO É VERIFICADO POR TESTE.** O M14 acrescenta o primeiro
// controle faturável numa tela de autoria: rodar chama o modelo de verdade com a chave do
// operador. O M12 e o M13 declararam "nenhum e2e clica em controle faturável" em prosa; aqui a
// propriedade é mecânica — `src/test/no-billable-click.test.ts` lê este arquivo e falha se o clique
// aparecer. A ideia vem de medir o `agenta`, cujo modo de provider que gastaria de verdade lança
// "not implemented yet" em vez de depender de disciplina.
//
// HONESTIDADE SOBRE O ESCOPO: roda hermético contra o Vite local com `VITE_USE_MOCKS=true`, como
// todo e2e deste repositório. Prova a JORNADA DA INTERFACE — não prova que a invocação atravessa o
// BFF real até um provider real. Essa metade é exercitada UMA vez contra o `app-dev`, com chave
// real e custo declarado, e registrada como evidência de aceitação; um mock jamais poderia
// prová-la.

import { test, expect } from '@playwright/test';

test.describe('M14 — a jornada do playground', () => {
  test('do menu ao playground: preencher variáveis e salvar, sem rodar', async ({ page }) => {
    // O ÚNICO goto do arquivo. Daqui em diante, só clique.
    await page.goto('/');

    // --- 1. chegar à capacidade pelo MENU ---
    await page.getByRole('button', { name: 'Prompts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Prompts', level: 1 })).toBeVisible();

    // --- 2. chegar ao catálogo pelo submenu ---
    await page.getByRole('button', { name: 'Catálogo', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: /catálogo de prompts/i, level: 1 }),
    ).toBeVisible();

    // --- 3. abrir o prompt ---
    await page.getByRole('link', { name: 'saudacao', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'saudacao', level: 1 })).toBeVisible();

    // --- 4. o playground é alcançado DAQUI, não de um item de menu ---
    // Ele é sempre de UM prompt; um item de menu levaria a uma tela que não sabe de qual.
    await page.getByRole('link', { name: 'Playground' }).click();
    await expect(page.getByRole('heading', { name: /Playground — saudacao/i })).toBeVisible();

    // --- 5. DoD-2: o campo veio do que a API DECLARA ---
    // `saudacao` v3 é "Olá {{nome}}, sou o assistente. Como ajudo?" — uma variável, `nome`.
    await expect(page.getByLabel('nome')).toBeVisible();

    // --- 6. DoD-3: a tela diz ANTES que rodar custa ---
    await expect(page.getByTestId('playground-aviso-custo')).toContainText(
      /consome a quota da sua chave/i,
    );

    // --- 7. DoD-4: o campo da chave é de senha ---
    await expect(page.getByLabel('Chave de API do modelo')).toHaveAttribute('type', 'password');

    // --- 8. o estado vazio da saída diz que ainda não rodou — não fica em branco ---
    await expect(page.getByTestId('playground-saida')).toContainText(/Nada foi executado ainda/i);

    // --- 9. DoD-5, a metade barata: sem preencher, não dá nem para tentar ---
    await expect(page.getByRole('button', { name: 'Rodar' })).toBeDisabled();

    // --- 10. preencher a variável e a chave ---
    await page.getByLabel('nome').fill('Ana');
    await page.getByLabel('Chave de API do modelo').fill('sk-exemplo-de-teste');

    // O botão fica habilitado — a jornada PROVA que dava para rodar, e deliberadamente NÃO roda.
    await expect(page.getByRole('button', { name: 'Rodar' })).toBeEnabled();

    // --- 11. DoD-6: salvar cria revisão nova com o texto da tela ---
    await page.getByRole('button', { name: /Salvar como nova revisão/i }).click();
    await expect(page).toHaveURL(/\/promptly\/saudacao$/);
    await expect(page.getByRole('heading', { name: 'saudacao', level: 1 })).toBeVisible();
  });

  test('do playground se volta ao prompt por clique, sem o botão do navegador', async ({ page }) => {
    // Todo formulário tem saída explícita. O item do submenu leva ao overview da capacidade, não a
    // este prompt — sem o link de volta, a tela seria uma sala sem porta.
    await page.goto('/');

    await page.getByRole('button', { name: 'Prompts', exact: true }).click();
    await page.getByRole('button', { name: 'Catálogo', exact: true }).click();
    await page.getByRole('link', { name: 'saudacao', exact: true }).click();
    await page.getByRole('link', { name: 'Playground' }).click();
    await expect(page.getByRole('heading', { name: /Playground — saudacao/i })).toBeVisible();

    await page.getByRole('link', { name: /Voltar ao prompt/i }).click();

    await expect(page).toHaveURL(/\/promptly\/saudacao$/);
    await expect(page.getByRole('heading', { name: 'saudacao', level: 1 })).toBeVisible();
  });
});
