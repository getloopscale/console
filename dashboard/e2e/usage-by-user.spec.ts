// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// M142 DoD-2 — a jornada até o consumo por end-user, POR CLIQUE desde a raiz, afirmando CONTEÚDO.
//
// POR QUE ESTE ARQUIVO EXISTE, tendo `observability-screens.spec.ts` já derivado do registro.
//
// Aquele spec percorre TODAS as capacidades e afirma o que é comum a todas: a URL resolveu, o
// heading montou, nenhum error boundary estourou. É a garantia certa para 14 telas — e é
// exatamente o que o DoD-2 nomeia como insuficiente: *"uma tela pode responder 200 e não mostrar
// nada"*.
//
// E não é hipótese. Medido em 2026-08-03, antes deste arquivo: NÃO havia handler de mock para
// `/v1/dashboard/lens/usage-by-user`. A tela subia, mostrava corretamente "Não foi possível
// carregar o consumo" — e o spec derivado ficava VERDE, porque o heading estava lá. A tela
// alcançável e vazia é o defeito que o M142 foi aberto para impedir, e o portão que eu tinha não
// o via.
//
// O precedente é do M24: `trust-handlers.ts` registra DOIS prefixos (`''` e `/api`) e a razão
// escrita lá é a mesma que se aplica aqui — *"o modo de falha que custou a primeira execução deste
// e2e, em que a tela corretamente mostrou 'não foi possível carregar' e o teste acusou"*. Aquele
// e2e acusou porque afirmava conteúdo. Este passa a afirmar também.

import { expect, test } from '@playwright/test';

/**
 * Os números vêm do handler de mock, que por sua vez espelha o que foi MEDIDO no app-dev em
 * 2026-08-03 (49.373 spans do maior consumidor, 17 spans sem preço). Afirmar o número exato — e
 * não `/\d+/` — é o que faz o teste morrer se o mapeamento de campo trocar `spans` por
 * `inputTokens`, que é a classe de defeito que um "200 + heading" nunca pega.
 */
const SPANS_DO_MAIOR_CONSUMIDOR = '49,373';

test.describe('M142 — o consumo por end-user alcançado pelo produto', () => {
  test('da raiz até a tela POR CLIQUE, mostrando os números que vieram do serviço', async ({
    page,
  }) => {
    const erros: string[] = [];
    page.on('pageerror', (e) => erros.push(e.message));

    // Desde a RAIZ. Digitar `/observability/usage-by-user` provaria a rota e nada sobre o
    // caminho que o operador de fato tem — foi o que deixou quatro telas inalcançáveis noutra
    // capacidade, com três rodadas de validação passando por cima porque validavam digitando.
    await page.goto('/');

    await page.getByRole('button', { name: /^Observability$/ }).click();
    await page.getByRole('button', { name: /^Usage by user$/ }).click();

    await expect(page).toHaveURL(/\/observability\/usage-by-user$/);
    await expect(page.getByRole('heading', { name: /usage by user/i }).first()).toBeVisible();

    // CONTEÚDO: um número que só pode estar na tela se a resposta do serviço foi lida, mapeada
    // e renderizada. É a asserção que o spec derivado não faz.
    await expect(page.getByText(SPANS_DO_MAIOR_CONSUMIDOR).first()).toBeVisible();

    // …e a lacuna de preço declarada NA TELA (DoD-3 pelo lado do navegador, não só do jsdom).
    await expect(page.getByTestId('usage-unpriced-notice')).toBeVisible();

    // O balde não-atribuído é linha ordinária, com rótulo (DoD-4).
    await expect(page.getByText(/não atribuído/i).first()).toBeVisible();

    await expect(page.getByText(/não foi possível carregar/i)).toHaveCount(0);
    expect(erros, `erros não capturados na página: ${erros.join('; ')}`).toHaveLength(0);
  });
});
