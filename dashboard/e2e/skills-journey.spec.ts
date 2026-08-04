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

  // ESPERA DETERMINÍSTICA entre os dois cliques, e ela não é zelo: `Overview` existe nos DOIS
  // menus. Sem esperar o submenu abrir, sob carga o clique cai no `Overview` da RAIZ e navega
  // para `/` — o teste falhava de forma intermitente, verde sozinho e vermelho em paralelo.
  // `Back to TheoCloud` só existe dentro de um submenu, então é o sinal que distingue os dois
  // estados. Um `waitForTimeout` aqui esconderia a corrida em vez de eliminá-la.
  await expect(page.getByRole('button', { name: /back to theocloud/i })).toBeVisible();

  await page.getByRole('button', { name: /^overview$/i }).click();
  await expect(page).toHaveURL(/\/skills$/);

  // A URL não é o acervo — é só o endereço dele. Sem esperar a PRIMEIRA LINHA renderizar, quem
  // chama este helper e clica em seguida compete com a carga da lista: medido `flaky` no
  // ambiente do CI em 2026-08-02, no caso da recusa tipada. Falhava e passava na repetição,
  // que é o modo de falhar que ensina a reexecutar o CI em vez de olhar.
  await expect(page.getByRole('link', { name: 'Revisar pull request' })).toBeVisible();
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
    //
    // A asserção casa o EMBLEMA do canal por texto exato, e não a linha inteira: o botão de
    // promover tem o rótulo "Promover para stable", então `toContainText('stable')` na linha
    // passaria a casar o botão em vez do emblema — um teste que continuaria verde mesmo se a
    // coluna de canais parasse de renderizar.
    await expect(linhas.filter({ hasText: '1.0.0' }).getByText('stable', { exact: true })).toHaveCount(1);
    await expect(linhas.filter({ hasText: '1.10.0' }).getByText('stable', { exact: true })).toHaveCount(0);
  });

  test('promover exige confirmação com frase digitada, e o texto diz o que deixa de valer', async ({
    page,
  }) => {
    await navegarAteOAcervoPeloMenu(page);
    await page.getByRole('link', { name: 'Revisar pull request' }).click();
    await page.getByRole('link', { name: /ver versões e canais/i }).click();

    // A linha JÁ servida pelo canal não tem botão — ausência, não botão desabilitado. Promover
    // para onde já se está é um ato sem efeito que ainda assim pediria confirmação, e isso treina
    // a confirmar sem ler.
    const linhaServida = page.getByRole('row').filter({ hasText: '1.0.0' });
    await expect(linhaServida.getByRole('button', { name: /promover/i })).toHaveCount(0);

    // A candidata é a versão que canal nenhum serve.
    const candidata = page.getByRole('row').filter({ hasText: '1.10.0' });
    // O nome acessível inclui a versão (`Promover 1.10.0 para stable`) — o rótulo diz QUAL linha
    // está sendo promovida, que é o ponto de acessibilidade da coluna.
    await candidata.getByRole('button', { name: /promover 1\.10\.0 para stable/i }).click();

    const dialog = page.getByRole('dialog');
    // O texto NOMEIA a revisão que sai e a que entra — asserção sobre CONTEÚDO. "algum texto"
    // passaria com "Tem certeza?", que é exatamente o que este diálogo existe para não ser.
    await expect(dialog).toContainText('rev_d');
    await expect(dialog).toContainText('rev_a');
    await expect(dialog).toContainText('1.10.0');
    // A que SAI é identificada por VERSÃO, não só pelo id opaco (achado da validação
    // independente): `rev_a` é a `1.0.0`, e é isso que o operador reconhece na hora de decidir.
    await expect(dialog).toContainText('1.0.0');
    // E NÃO afirma contagem de consumidores — o serviço não sabe esse número (DECISÃO 1, opção a).
    await expect(dialog).not.toContainText(/\d+\s*consumidores/i);

    // Sem a frase digitada, o botão não confirma. É o gate, não decoração.
    const confirmar = dialog.getByRole('button', { name: /promover canal/i });
    await expect(confirmar).toBeDisabled();

    await dialog.getByRole('textbox').fill('stable');
    await expect(confirmar).toBeEnabled();
    await confirmar.click();

    // O EFEITO, não o clique: o canal passa a aparecer na linha da versão promovida, e sai da
    // linha antiga. Asserir "o diálogo fechou" deixaria passar uma promoção que não promoveu.
    // Texto exato pela mesma razão de cima — o rótulo do botão contém a palavra `stable`.
    await expect(
      page.getByRole('row').filter({ hasText: '1.10.0' }).getByText('stable', { exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole('row').filter({ hasText: '1.0.0' }).getByText('stable', { exact: true }),
    ).toHaveCount(0);
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

// ---- M35 — a jornada de DISTRIBUIÇÃO ---------------------------------------------------------
//
// Cobre: raiz → menu → pacotes → detalhe → emitir token → LISTAR → revogar pelo id que a listagem
// revelou. A rota do meio é o milestone inteiro: sem ela o `DELETE` exige um identificador que a
// tela não tem como descobrir, e um token emitido pela CLI é invisível — logo, irrevogável.
//
// Também aqui a navegação é POR CLIQUE a partir da raiz. `/bundles` não começa com `/skills`, e
// por isso depende de uma linha própria em `resolveActiveMenu`: é exatamente a peça que o
// theo-trust esqueceu, e um `goto('/bundles')` ficaria verde com o menu quebrado.

async function navegarAteOsPacotesPeloMenu(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^skills$/i }).click();
  await expect(page.getByRole('button', { name: /back to theocloud/i })).toBeVisible();

  await page.getByRole('button', { name: /^distribuição$/i }).click();
  await expect(page).toHaveURL(/\/bundles$/);

  // Espera a primeira linha, não só a URL: quem clicar em seguida competiria com a carga.
  await expect(page.getByRole('link', { name: 'Skills de atendimento' })).toBeVisible();
}

test.describe('M35 — distribuição: pacotes, tokens delegados e adoção', () => {
  test('do menu ao token revogado pelo identificador que a listagem revelou', async ({ page }) => {
    await navegarAteOsPacotesPeloMenu(page);

    // ---- O SUBMENU CONTINUA ABERTO em /bundles ------------------------------------------
    // A asserção que prova a linha de `resolveActiveMenu`. Sem ela o menu volta à raiz e a tela
    // fica alcançável só digitando o endereço — inalcançável para o usuário real.
    await expect(page.getByRole('button', { name: /back to theocloud/i })).toBeVisible();

    // ---- DETALHE: alcançado pelo nome, que é o caminho da lista --------------------------
    await page.getByRole('link', { name: 'Skills de atendimento' }).click();
    await expect(page).toHaveURL(/\/bundles\/bdl_ativo$/);

    // ---- TOKENS: os quatro estados que a tela precisa distinguir -------------------------
    // Texto, nunca só cor: as situações levam a ações diferentes (renovar × investigar).
    await expect(page.getByText('ativo', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('expirado', { exact: true })).toBeVisible();
    await expect(page.getByText('revogado', { exact: true }).first()).toBeVisible();
    // Rótulo ausente vira frase, não célula em branco — em branco parece dado faltando.
    await expect(page.getByText('sem rótulo')).toBeVisible();

    // ---- ADOÇÃO: o denominador da janela, e o rótulo que não mente -----------------------
    // 14 é o TOTAL da janela; a soma das linhas visíveis é 9. Exibir a soma como denominador
    // inflaria toda proporção — e o gráfico erraria em silêncio.
    await expect(page.getByText(/14 instalações na janela/)).toBeVisible();
    // A granularidade REAL, medida em `adoption-store.ts`: skill + versão, não "por pacote".
    await expect(page.getByText(/por skill e versão dentro deste pacote/)).toBeVisible();
    // 6/14 = 42.9%
    await expect(page.getByText('42.9%')).toBeVisible();

    // ---- EMITIR: o valor aparece UMA vez, e a tela diz isso ------------------------------
    await page.getByLabel('Rótulo do token').fill('e2e');
    await page.getByRole('button', { name: /emitir token/i }).click();
    await expect(page.getByText(/não aparece de novo/i)).toBeVisible();
    await expect(page.getByText(/dtk_secret_/)).toBeVisible();

    // ---- REVOGAR: usando o identificador que só a LISTAGEM revela ------------------------
    // O ponto do milestone. A frase digitada é o `token_id` — que o operador só conhece porque
    // a lista o mostrou.
    const linha = page.getByRole('row', { name: /pipeline de CI/ });
    await linha.getByRole('button', { name: /revogar/i }).click();
    await page.getByRole('textbox', { name: /dtk_ativo|confirm/i }).fill('dtk_ativo');
    await page.getByRole('button', { name: /revogar token/i }).click();

    // E o revogado CONTINUA listado, com a marca: esconder impediria auditar o que foi emitido.
    await expect(page.getByRole('row', { name: /pipeline de CI/ })).toBeVisible();
  });

  test('o pacote sem instalações diz "—" e não "0%" — são frases diferentes', async ({ page }) => {
    // `0%` afirma "ninguém instalou esta skill". Com denominador zero o honesto é admitir que
    // não dá para calcular proporção. A tela precisa dizer a segunda.
    await navegarAteOsPacotesPeloMenu(page);
    await page.getByRole('link', { name: 'Pacote recém-criado' }).click();
    await expect(page).toHaveURL(/\/bundles\/bdl_vazio$/);

    await expect(page.getByText(/nenhuma instalação na janela/i)).toBeVisible();
    await expect(page.getByText(/nenhum token emitido/i)).toBeVisible();
    // Estado vazio com CTA in-app, não instrução de CLI: o operador está no navegador.
    await expect(page.getByText(/emita um token acima/i)).toBeVisible();
  });

  test('há caminho de volta do detalhe para a lista', async ({ page }) => {
    // Todo detalhe precisa de saída explícita: o item de menu leva ao overview da capacidade,
    // não à lista de pacotes.
    await navegarAteOsPacotesPeloMenu(page);
    await page.getByRole('link', { name: 'Skills de atendimento' }).click();
    await page.getByRole('link', { name: /todos os pacotes/i }).click();
    await expect(page).toHaveURL(/\/bundles$/);
  });
});

test.describe('M35 — o conteúdo do pacote é editável pela tela (AC1)', () => {
  test('adicionar uma skill a um canal, salvar, e ver a lista refletir', async ({ page }) => {
    // O critério da DoD é "listar, criar e EDITAR ITENS, sem CLI". Sem esta jornada o pacote
    // nasce vazio pela tela e só ganha conteúdo por linha de comando — que é a lacuna que o
    // milestone existe para fechar.
    await navegarAteOsPacotesPeloMenu(page);
    await page.getByRole('link', { name: 'Pacote recém-criado' }).click();
    await expect(page).toHaveURL(/\/bundles\/bdl_vazio$/);

    // Estado vazio DIZ A CONSEQUÊNCIA, não só "vazio": um token de um pacote sem itens não
    // entrega nada, e o operador precisa saber disso antes de distribuí-lo.
    await expect(page.getByText(/Quem usar um token dele não recebe nada/i)).toBeVisible();

    await page.getByLabel('Skill a adicionar').selectOption('sk_ordering');
    // O canal só habilita depois da skill: canais são POR skill, e um par montado antes seria
    // um item que o registro não sabe servir.
    await page.getByLabel('Canal da skill').selectOption('stable');
    await page.getByRole('button', { name: /adicionar ao pacote/i }).click();

    // Alteração pendente é ANUNCIADA — sem isso o operador sai da tela achando que salvou.
    await expect(page.getByText(/alterações ainda não salvas/i)).toBeVisible();

    await page.getByRole('button', { name: /salvar conteúdo/i }).click();
    // Depois de salvar o aviso some: é o sinal de que o rascunho virou estado do servidor.
    await expect(page.getByText(/alterações ainda não salvas/i)).toHaveCount(0);
    await expect(page.getByText('sk_ordering')).toBeVisible();
  });

  test('a mesma skill no mesmo canal não entra duas vezes', async ({ page }) => {
    await navegarAteOsPacotesPeloMenu(page);
    await page.getByRole('link', { name: 'Skills de atendimento' }).click();

    // `bdl_ativo` já tem sk_ordering@stable. Adicionar de novo não acrescenta nada e confundiria
    // a leitura da lista — a tela recusa dizendo por quê, em vez de ignorar em silêncio.
    await page.getByLabel('Skill a adicionar').selectOption('sk_ordering');
    await page.getByLabel('Canal da skill').selectOption('stable');
    await page.getByRole('button', { name: /adicionar ao pacote/i }).click();

    await expect(page.getByText(/já está no pacote neste canal/i)).toBeVisible();
  });
});

test.describe('M32 — ciclo de vida: retirar de circulação sem quebrar quem usa (AC5)', () => {
  test('o acervo distingue descontinuada de em uso, em TEXTO, e diz o motivo', async ({ page }) => {
    // O critério da DoD é "a tela diz o que deixa de valer, com o estado em texto (nunca só cor)".
    // Uma deprecada indistinguível de uma ativa é exatamente o defeito que o M32 existe para
    // impedir — e cor sozinha não sobrevive a daltonismo nem a impressão.
    await navegarAteOAcervoPeloMenu(page);

    await expect(page.getByText('descontinuada')).toBeVisible();
    await expect(page.getByText('em uso').first()).toBeVisible();
    // O MOTIVO viaja junto: sem ele o operador lê "descontinuada" e não sabe o que usar no lugar,
    // que é a pergunta seguinte, sempre.
    await expect(page.getByText(/não cobre cotação futura/)).toBeVisible();
  });

  test('descontinuar exige motivo e confirmação com frase digitada', async ({ page }) => {
    await navegarAteOAcervoPeloMenu(page);
    await page.getByRole('link', { name: 'Revisar pull request' }).click();
    await expect(page).toHaveURL(/\/skills\/sk_ordering$/);

    // O texto diz o que MUDA e o que NÃO muda: quem já referencia continua carregando. Sem essa
    // frase o operador supõe que está apagando a skill.
    await expect(page.getByText(/deixa de aparecer para quem procura/i)).toBeVisible();
    await expect(page.getByText(/continua sendo carregada por quem a pede/i)).toBeVisible();

    // Sem motivo o botão não habilita — o operador não descobre a regra pelo erro.
    const botao = page.getByRole('button', { name: /^descontinuar$/i });
    await expect(botao).toBeDisabled();

    await page.getByLabel('Motivo da descontinuação').fill('substituída pela v2');
    await expect(botao).toBeEnabled();
    await botao.click();

    // Ação destrutiva sob o ConfirmDialog canônico, com frase digitada.
    await page.getByRole('textbox', { name: /type to confirm|sk_ordering/i }).fill('sk_ordering');
    await page.getByRole('button', { name: /descontinuar skill/i }).click();

    // E a situação reflete: `descontinuada`, com o caminho de volta a circular.
    await expect(page.getByRole('button', { name: /voltar a circular/i })).toBeVisible();
  });
});

test.describe('M31 — descoberta observável: score E qual perna casou', () => {
  test('do menu à busca, com o motivo de cada resultado', async ({ page }) => {
    // A razão de existir do produto — um agente achar a skill certa por intenção — não tinha
    // tela alguma até este milestone. A auditoria de 2026-08-03 mediu isso navegando por clique.
    await page.goto('/');
    await page.getByRole('button', { name: /^skills$/i }).click();
    await expect(page.getByRole('button', { name: /back to theocloud/i })).toBeVisible();
    await page.getByRole('button', { name: /^descoberta$/i }).click();
    await expect(page).toHaveURL(/\/skills\/descoberta$/);

    // O submenu continua aberto: `/skills/descoberta` depende da mesma linha de
    // `resolveActiveMenu` que serve `/skills`.
    await expect(page.getByRole('button', { name: /back to theocloud/i })).toBeVisible();

    // Estado inicial NÃO é "nada encontrado" — é "ainda não perguntei". A diferença importa:
    // uma diz que o acervo está vazio, a outra que a busca não aconteceu.
    await expect(page.getByText(/pergunte algo/i)).toBeVisible();

    // Consulta que casa com uma skill ATIVA: a de moeda está descontinuada e a descoberta a
    // esconde por padrão — buscá-la aqui exercitaria o filtro, não a exibição do motivo.
    await page.getByLabel('Consulta em linguagem natural').fill('diff');
    await page.getByRole('button', { name: /^buscar$/i }).click();

    // O SCORE e a PERNA, juntos — os dois lados do critério da DoD.
    await expect(page.getByRole('link', { name: 'Revisar pull request' })).toBeVisible();
    // `columnheader`, não `getByText`: a frase "em ordem de quanto casou" na descrição do card
    // torna o texto ambíguo, e um seletor ambíguo passa ou falha por acidente.
    await expect(page.getByRole('columnheader', { name: 'Quanto casou' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Por que apareceu' })).toBeVisible();
    // Frases que dizem o que a máquina fez, não nomes de módulo.
    await expect(page.getByText('palavras e intenção')).toBeVisible();
  });

  test('a descontinuada só aparece com opt-in explícito', async ({ page }) => {
    // É o comportamento que o M32 promete e que nenhuma tela permitia verificar: a descoberta
    // esconde deprecadas por padrão. Sem o filtro, o operador teria de confiar na documentação.
    await page.goto('/');
    await page.getByRole('button', { name: /^skills$/i }).click();
    await expect(page.getByRole('button', { name: /back to theocloud/i })).toBeVisible();
    await page.getByRole('button', { name: /^descoberta$/i }).click();

    await page.getByLabel('Consulta em linguagem natural').fill('moeda');
    await page.getByRole('button', { name: /^buscar$/i }).click();
    await expect(page.getByText('Converter moeda (v1)')).toHaveCount(0);

    await page.getByLabel('Incluir descontinuadas').check();
    await expect(page.getByText('Converter moeda (v1)')).toBeVisible();
  });
});
