import { describe, it, expect } from 'vitest';
import { gerarTrechoDeConsumo, INTERFACES, type Alvo } from './consumo';

/**
 * M21 DoD-2 — a aba de consumo entrega código que RODA.
 *
 * *"Um trecho genérico que exige edição reprova."* Hoje quem quer consumir um prompt sai da tela e
 * vai ler o README do SDK — a aba existe para que o catálogo deixe de ser vitrine e vire ponto de
 * partida.
 *
 * O gerador é uma função PURA, e é por isso que os testes aqui afirmam sobre o TEXTO. "Roda" é uma
 * propriedade da string, não da árvore renderizada: dentro do JSX, a asserção viraria sobre o
 * componente, e a diferença apareceria no dia em que alguém mudasse o espaçamento e o trecho
 * quebrasse sem nenhum teste falhar.
 *
 * **A forma vem do contrato real, lido no código, não de memória:** `@usetheo/promptly-sdk`,
 * `new PromptlyClient({ baseUrl, apiKey })`, `getPrompt(name, { label | version, vars })`, e a
 * ferramenta MCP chama-se `get_prompt`.
 *
 * **`vars`, não `variables`** — a distinção custou um BLOCKER de review. `variables` existe no
 * contrato, mas é campo do RESULTADO (`Prompt.variables: string[]`); a opção de entrada é `vars`
 * (`packages/sdk/src/index.ts:158`). O teste que existia travava o nome ERRADO no lugar: ele
 * afirmava `not.toContain('variables')` para o caso sem variáveis, e com isso cimentava o engano.
 */
const COM_AMBIENTE: Alvo = {
  nome: 'atendimento',
  compoe: false,
  ultimaVersao: 7,
  label: 'production',
  ambienteEProducao: true,
  variaveis: ['pergunta'],
  baseUrl: 'https://app-dev.usetheo.dev/v1/promptly',
};

const SEM_AMBIENTE: Alvo = { ...COM_AMBIENTE, label: null, ambienteEProducao: true };
const SO_STAGING: Alvo = { ...COM_AMBIENTE, label: 'staging', ambienteEProducao: false };
const QUE_COMPOE: Alvo = { ...COM_AMBIENTE, compoe: true };

describe('gerarTrechoDeConsumo — o trecho traz o prompt já preenchido', () => {
  it('as três interfaces estão declaradas, e só elas', () => {
    expect(INTERFACES.map((i) => i.id)).toEqual(['sdk', 'rest', 'mcp']);
  });

  it('o nome do prompt aparece nas três — nenhuma exige edição para apontar para ele', () => {
    for (const iface of INTERFACES) {
      expect(gerarTrechoDeConsumo(iface.id, COM_AMBIENTE)).toContain('atendimento');
    }
  });

  it('com ambiente servido, o trecho usa o AMBIENTE e não a versão', () => {
    // O consumidor de produção quer o ponteiro móvel — é o que a promoção existe para dar. Gerar
    // `version: 7` fixo ensinaria a congelar, que é o oposto.
    const sdk = gerarTrechoDeConsumo('sdk', COM_AMBIENTE);
    expect(sdk).toContain("label: 'production'");
    expect(sdk).not.toContain('version:');

    const rest = gerarTrechoDeConsumo('rest', COM_AMBIENTE);
    expect(rest).toContain('label=production');
    expect(rest).not.toContain('version=');
  });

  it('sem ambiente algum, o trecho usa a versão — o único endereço honesto que sobra', () => {
    const sdk = gerarTrechoDeConsumo('sdk', SEM_AMBIENTE);
    expect(sdk).toContain('version: 7');
    expect(sdk).not.toContain('label:');
  });

  it('as variáveis declaradas entram no exemplo de chamada', () => {
    // Sem elas, o trecho roda e devolve o template cru com `{{pergunta}}` dentro — "funciona" e
    // produz lixo, que é o desfecho que o M20 aprendeu a recusar.
    const sdk = gerarTrechoDeConsumo('sdk', COM_AMBIENTE);
    expect(sdk).toContain('pergunta');
  });

  it('a opção de valores chama-se `vars` — o nome do CONTRATO, não o do resultado', () => {
    // O BLOCKER. Em TypeScript, `variables` nem compila (`TS2353: … does not exist in type
    // GetPromptOptions`). Em JavaScript compila e entrega o TEMPLATE CRU ao modelo, em silêncio —
    // o pior dos dois desfechos, e exatamente o que este módulo diz querer evitar.
    const sdk = gerarTrechoDeConsumo('sdk', COM_AMBIENTE);
    expect(sdk).toContain('vars: {');
    expect(sdk).not.toContain('variables: {');
  });

  it('prompt sem variável alguma não gera um objeto de valores vazio', () => {
    // Um `vars: {}` pendurado no exemplo é ruído que o leitor tenta interpretar.
    const semVars = gerarTrechoDeConsumo('sdk', { ...COM_AMBIENTE, variaveis: [] });
    expect(semVars).not.toContain('vars: {');
  });

  it('a ferramenta MCP é a real — `get_prompt`, não um nome inventado', () => {
    expect(gerarTrechoDeConsumo('mcp', COM_AMBIENTE)).toContain('get_prompt');
  });

  it('o bloco MCP traz as DUAS metades: apontar o cliente e chamar a ferramenta', () => {
    // O `/review` mediu que o bloco anterior não era JSON (tinha `//`), não era a requisição
    // JSON-RPC que o MCP fala, e não dizia como apontar um cliente para o servidor. Não havia o
    // que executar — e a aba prometia "código que roda".
    const mcp = gerarTrechoDeConsumo('mcp', COM_AMBIENTE);
    expect(mcp).toContain('mcpServers'); // como apontar o cliente
    expect(mcp).toContain('tools/call'); // o método JSON-RPC de verdade
    expect(mcp).toContain('"jsonrpc": "2.0"');
    // E a URL do servidor sai do alvo, como nas outras interfaces.
    expect(mcp).toContain(COM_AMBIENTE.baseUrl);
  });

  it('o pacote do SDK é o publicado, e o import é o que existe', () => {
    const sdk = gerarTrechoDeConsumo('sdk', COM_AMBIENTE);
    expect(sdk).toContain("@usetheo/promptly-sdk");
    expect(sdk).toContain('PromptlyClient');
  });

  it('NENHUM trecho carrega credencial, nem algo com forma de credencial', () => {
    // Um trecho é feito para ser COPIADO. Um exemplo com forma de chave real convida a colar a
    // chave real ali e commitá-la — e o repositório é explícito sobre segredo em texto copiável.
    const forma = /promptly_live_|sk-[A-Za-z0-9]|Bearer\s+[A-Za-z0-9]{8}/;
    for (const iface of INTERFACES) {
      for (const alvo of [COM_AMBIENTE, SEM_AMBIENTE]) {
        expect(gerarTrechoDeConsumo(iface.id, alvo)).not.toMatch(forma);
      }
    }
  });

  it('a credencial vem do ambiente, e o trecho diz de onde', () => {
    expect(gerarTrechoDeConsumo('sdk', COM_AMBIENTE)).toContain('THEO_API_KEY');
    expect(gerarTrechoDeConsumo('rest', COM_AMBIENTE)).toContain('THEO_API_KEY');
  });

  it('nome com pasta é escapado onde precisa ser', () => {
    // O M16 trouxe pastas: `m16-sup/relatorio` é um NOME. No SDK ele é argumento e vai cru; no
    // curl ele é caminho de URL e precisa ser codificado, senão a barra vira segmento e a chamada
    // bate em outro endereço — silenciosamente, com 404.
    const alvo: Alvo = { ...COM_AMBIENTE, nome: 'm16-sup/relatorio' };
    expect(gerarTrechoDeConsumo('sdk', alvo)).toContain("'m16-sup/relatorio'");
    expect(gerarTrechoDeConsumo('rest', alvo)).toContain('m16-sup%2Frelatorio');
  });

  it('prompt que COMPÕE pede resolução no REST — senão entrega o marcador literal', () => {
    // Medido contra o `app-dev`: sem `resolve=true`, o corpo devolvido carrega
    // `@@@promptly:name=…@@@` cru, e o consumidor o manda ao modelo achando que mandou a política.
    // É o desfecho que o módulo de resolução chama de o pior — o prompt "funciona" e produz lixo.
    expect(gerarTrechoDeConsumo('rest', QUE_COMPOE)).toContain('resolve=true');
  });

  it('prompt que NÃO compõe não paga a travessia do grafo', () => {
    // O CONTROLE, e a mesma decisão de custo do DoD-5 do M20: resolver custa, e quem não
    // referencia ninguém não deve pagar por isso.
    expect(gerarTrechoDeConsumo('rest', COM_AMBIENTE)).not.toContain('resolve=true');
  });

  it('o trecho do SDK AVISA quando o prompt compõe, porque o SDK ainda não resolve', () => {
    // `usetheoai/theo-promptly#84`: `getPrompt` monta a URL sem `resolve`. Entregar o trecho sem a
    // ressalva daria um exemplo que roda e produz lixo — e o consumidor não teria como saber.
    // Um aviso honesto vale mais que um trecho bonito que mente.
    const sdk = gerarTrechoDeConsumo('sdk', QUE_COMPOE);
    expect(sdk).toMatch(/ATENÇÃO/);
    expect(sdk).toContain('@@@promptly:');
    // E aponta o caminho que FUNCIONA hoje, em vez de só reclamar.
    expect(sdk).toMatch(/REST/);
  });

  it('sem composição, o trecho do SDK não carrega ressalva alguma', () => {
    expect(gerarTrechoDeConsumo('sdk', COM_AMBIENTE)).not.toMatch(/ATENÇÃO/);
  });

  it('os trechos dizem QUAL credencial — a da plataforma, e onde obtê-la', () => {
    // Medido: a borda resolve uma chave `theo_live_…` do theo-cloud e o broker cunha a do serviço
    // por inquilino. Um trecho que só diz "a credencial vem do ambiente" fez EU levar 401 na
    // primeira execução — e eu conheço o sistema. O usuário concluiria que o produto está quebrado.
    for (const id of ['sdk', 'rest'] as const) {
      const t = gerarTrechoDeConsumo(id, COM_AMBIENTE);
      expect(t).toMatch(/API Tokens/);
      expect(t).toContain('promptly:read');
    }
  });

  it('um prompt que serve só staging é marcado como NÃO-produção', () => {
    // O gerador continua publicando o ambiente — publicar versão fixa seria pior. O que a marcação
    // muda é a TELA poder dizer que não é produção; sem ela, o operador cola `staging` num serviço
    // e supõe o contrário. Medido pelo `/review`.
    expect(SO_STAGING.ambienteEProducao).toBe(false);
    expect(gerarTrechoDeConsumo('sdk', SO_STAGING)).toContain("label: 'staging'");
  });

  it('a URL base vem do alvo, nunca fixa no gerador', () => {
    // Fixar `app-dev` aqui faria o trecho de produção apontar para desenvolvimento — e o operador
    // só descobriria em produção.
    const outro = gerarTrechoDeConsumo('rest', { ...COM_AMBIENTE, baseUrl: 'https://exemplo.test/v1/promptly' });
    expect(outro).toContain('https://exemplo.test/v1/promptly');
    expect(outro).not.toContain('app-dev');
  });
});
