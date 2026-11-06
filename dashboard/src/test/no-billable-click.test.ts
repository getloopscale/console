// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const E2E = resolve(AQUI, '../../e2e');
const WORKFLOW = resolve(AQUI, '../../../.github/workflows/e2e-ui.yml');

const SPECS_PROMPTLY = [
  'promptly-journey',
  'promptly-panel-journey',
  'promptly-authoring-journey',
  'promptly-playground-journey',
  // M15: a jornada do uso por revisão. Entra aqui no MESMO commit que a cria — o M14
  // registrou que uma spec fora desta lista quebra sem ninguém perceber.
  'promptly-uso-journey',
];

/**
 * M14 T5.1 — a propriedade "nenhum e2e clica em controle faturável", mecânica.
 *
 * O M12 e o M13 declararam essa propriedade **em prosa**, no cabeçalho das specs.
 * O M14 é o primeiro milestone que pode quebrá-la: ele acrescenta o único botão
 * do produto que gasta dinheiro do operador dentro de uma tela de autoria.
 *
 * A ideia vem de medir o `agenta`: lá o modo do provider que gastaria de verdade
 * **lança "not implemented yet"** em vez de depender da disciplina de quem
 * escreve o teste. Aqui o equivalente é esta asserção — ela falha se alguém
 * acrescentar o clique, e não depende de ninguém lembrar do combinado.
 *
 * ONDE ESTE ARQUIVO VIVE É PARTE DO CONTRATO. `vitest.config.ts` coleta apenas
 * `src/**` — um teste em `e2e/` nunca seria executado, e o gate pareceria
 * cobertura sem ser. Foi exatamente esse o defeito que deixou a spec do M12 fora
 * do CI e permitiu que ela quebrasse sem ninguém perceber.
 */
describe('nenhuma jornada e2e do promptly clica em controle faturável', () => {
  it.each(SPECS_PROMPTLY)('%s não clica no botão Rodar', (nome) => {
    const src = readFileSync(resolve(E2E, `${nome}.spec.ts`), 'utf8');

    // Anti-verde-vazio: se o arquivo sumir ou virar stub, a leitura passa e a
    // asserção não discriminaria nada.
    expect(src.length, `${nome}.spec.ts está vazio demais para ter sido lido`).toBeGreaterThan(200);

    // O que se proíbe é o CLIQUE, não a menção. Uma spec que assere
    // `getByRole('button', {name:'Rodar'})` estar **desabilitado** é a cobertura
    // que prova a guarda pré-gasto funcionando — bani-la removeria justamente o
    // teste que dá valor à propriedade.
    //
    // Casa "Rodar" seguido de `.click(` dentro de uma janela curta, para cobrir a
    // forma de uma linha e a encadeada em várias.
    expect(src, `${nome}.spec.ts clica no botão Rodar`).not.toMatch(
      /[Rr]odar['"]?\s*\}?\s*\)?[\s\S]{0,120}?\.click\(/,
    );

    // LIMITE HONESTO desta guarda: ela lê texto-fonte. Um clique escrito por um
    // localizador guardado numa variável com outro nome, ou por `page.locator` com
    // um seletor CSS, escapa. Ela cobre a forma que o repositório de fato usa —
    // não é prova, é o mesmo tipo de rede que o `agenta` monta no código do
    // provider, e vale exatamente enquanto o estilo se mantiver.
    expect(src).not.toMatch(/getByText\(['"]Rodar['"]\)[\s\S]{0,40}\.click\(/);
  });

  /**
   * O risco R3 do plano, e ele é histórico e não hipotético: a spec de autoria do
   * M12 existia e NÃO estava na lista explícita do workflow. Quando eu a quebrei,
   * ninguém percebeu — o CI não a rodava.
   */
  it('a spec do playground está na lista explícita do e2e-ui.yml', () => {
    const wf = readFileSync(WORKFLOW, 'utf8');

    expect(wf).toContain('e2e/promptly-playground-journey.spec.ts');
    // As três irmãs continuam lá — para que acrescentar uma não signifique perder outra.
    for (const nome of SPECS_PROMPTLY) {
      expect(wf, `${nome} sumiu da lista do workflow`).toContain(`e2e/${nome}.spec.ts`);
    }
  });
});
