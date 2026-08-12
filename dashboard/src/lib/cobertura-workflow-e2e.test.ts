import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RAIZ = resolve(__dirname, '..', '..', '..');
const WORKFLOW = join(RAIZ, '.github', 'workflows', 'e2e-ui.yml');
const DIR_E2E = resolve(__dirname, '..', '..', 'e2e');

/**
 * Todo spec de `e2e/` roda no CI — ou está aqui, com o motivo escrito.
 *
 * ## Por que este teste existe
 *
 * O job `e2e-ui` **enumera os specs à mão**. Um arquivo novo em `e2e/` simplesmente não entra
 * na lista, e nada acusa: a suíte local passa, o CI fica verde, e o spec nunca roda. Um gate
 * que não é executado não é um gate — é um arquivo.
 *
 * Isto foi medido em 2026-08-10, ao acrescentar `modal-visual-baseline.spec.ts`: dos 26
 * arquivos em `e2e/`, a lista do workflow cobria 24. E não é a primeira vez no mesmo dia que
 * um gate declarado não estava ligado — `npm run typecheck` passou a cobrir `e2e/` num commit
 * e continuou sem rodar no CI no seguinte, porque a esteira chama `npm run build`.
 *
 * ## Por que ele não troca a enumeração por uma varredura
 *
 * A resposta óbvia seria `npx playwright test --project=chromium` sem lista. Ela é melhor, e
 * eu não a apliquei: mudar o QUE a esteira executa é uma alteração que eu não consigo
 * verificar daqui, e o modo de falha (um spec que trava o job inteiro no carregamento) foi
 * exatamente o que custou três runs vermelhos hoje. Este teste torna a omissão **barulhenta**
 * sem mexer no que roda — e deixa a troca como decisão de quem puder observar o efeito.
 */

/**
 * Specs deliberadamente fora do CI. Um nome aqui é uma DECISÃO, não uma isenção: quem
 * acrescentar precisa escrever por que aquele arquivo não pode ser um gate automático.
 */
const FORA_DO_CI: Record<string, string> = {
  'promptly-journey-live.spec.ts':
    'conecta-se por CDP a um Chrome já autenticado e mede contra dado real de ambiente ' +
    'compartilhado. Embutir credencial para rodar no CI seria pôr um segredo no repositório. ' +
    'É verificação operada, e o próprio arquivo declara isso e se pula quando o Chrome não está lá.',
};

describe('cobertura do workflow e2e-ui', () => {
  it('todo spec de `e2e/` está no workflow ou tem exclusão declarada', () => {
    const workflow = readFileSync(WORKFLOW, 'utf8');
    const noDisco = readdirSync(DIR_E2E).filter((f) => f.endsWith('.spec.ts'));

    expect(noDisco.length, 'nenhum spec encontrado — o teste mediu o diretório errado').toBeGreaterThan(10);

    const ausentes = noDisco.filter(
      (f) => !workflow.includes(`e2e/${f}`) && !(f in FORA_DO_CI),
    );

    expect(
      ausentes,
      'Spec em `e2e/` que o CI NÃO executa.\n\n' +
        'O job `e2e-ui` enumera os specs à mão. Um arquivo fora da lista não roda, e nada\n' +
        'acusa: a suíte local passa e o CI fica verde sobre um gate que nunca foi executado.\n\n' +
        'Acrescente o arquivo à lista em `.github/workflows/e2e-ui.yml`. Se ele NÃO pode ser um\n' +
        'gate automático, declare-o em `FORA_DO_CI` neste arquivo, com o motivo — uma exclusão\n' +
        'sem motivo escrito é indistinguível de um esquecimento.\n',
    ).toEqual([]);
  });

  it('nenhuma exclusão declarada aponta para um arquivo que não existe mais', () => {
    // Uma exclusão órfã é pior que nenhuma: ela sugere que alguém decidiu algo sobre um
    // arquivo que já foi embora, e a próxima pessoa herda a decisão sem o objeto dela.
    const noDisco = new Set(readdirSync(DIR_E2E).filter((f) => f.endsWith('.spec.ts')));
    const orfas = Object.keys(FORA_DO_CI).filter((f) => !noDisco.has(f));

    expect(orfas, 'exclusão declarada para um spec que não existe mais').toEqual([]);
  });
});
