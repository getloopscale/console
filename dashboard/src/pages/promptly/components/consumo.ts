/**
 * M21 DoD-2 — o trecho de código que consome um prompt, já apontando para ELE.
 *
 * *"Um trecho genérico que exige edição reprova."* Hoje quem quer consumir um prompt sai da tela e
 * vai ler o README do SDK; esta função transforma o catálogo de vitrine em ponto de partida.
 *
 * Lógica **pura**, fora do React, porque "roda" é propriedade do TEXTO e não da árvore renderizada.
 * Dentro do JSX, a asserção seria sobre o componente, e o trecho quebraria no dia em que alguém
 * mudasse o espaçamento — sem nenhum teste falhar.
 *
 * **A forma foi lida do contrato real, não de memória:** `@usetheo/promptly-sdk` exporta
 * `PromptlyClient`, cujo construtor pede `{ baseUrl, apiKey }` e cujo `getPrompt(name, options)`
 * aceita `{ label | version, variables }` (`packages/sdk/src/index.ts:122,245,335`); a ferramenta
 * MCP chama-se `get_prompt` (`packages/mcp/src/create-mcp-server.ts:76`). Um trecho com API
 * inventada é pior que nenhum: o operador copia, falha, e conclui que o produto está quebrado.
 */

/** As três portas pelas quais um prompt é consumido. */
export interface ConsumptionInterface {
  readonly id: 'sdk' | 'rest' | 'mcp';
  /** O nome da porta na tela — "SDK (TypeScript)", "REST (curl)", "MCP". */
  readonly label: string;
  /**
   * A linguagem do bloco.
   *
   * `text` para o MCP não é preguiça: aquele bloco carrega DUAS coisas (a configuração do cliente e
   * a chamada), então não é um documento JSON analisável. Declará-lo `json` seria a mesma mentira
   * que o `/review` pegou — um rótulo que promete uma forma que o conteúdo não tem.
   */
  readonly language: 'typescript' | 'bash' | 'json' | 'text';
}

export const INTERFACES: readonly ConsumptionInterface[] = [
  { id: 'sdk', label: 'SDK (TypeScript)', language: 'typescript' },
  { id: 'rest', label: 'REST (curl)', language: 'bash' },
  { id: 'mcp', label: 'MCP', language: 'text' },
];

/** O prompt para o qual o trecho é gerado. */
export interface Target {
  readonly name: string;
  /**
   * Este prompt referencia outros? (M20)
   *
   * Decide se o trecho pede **resolução**. Um prompt que compõe, lido sem resolver, devolve o
   * marcador LITERAL — e o consumidor o manda ao modelo achando que mandou a política. É o desfecho
   * que o módulo de resolução chama de o pior: o prompt "funciona" e produz lixo.
   */
  readonly compoe: boolean;
  readonly latestVersion: number;
  /**
   * O ambiente que este prompt serve, quando serve algum.
   *
   * `null` é um fato — "nenhum ambiente aponta para este prompt" —, e não uma ausência de dado. A
   * distinção decide o trecho: com ambiente, ele usa o ponteiro móvel; sem, usa a versão.
   *
   * **Sim, há dois `label` neste arquivo, e não é descuido** — o /review de 2026-08-13 leu isto
   * como colisão. Este é o nome do PARÂMETRO que o trecho emite: `getPrompt(name, { label })` no
   * SDK, `?label=` no REST, `"label":` no MCP. Renomeá-lo para algo como `environmentLabel`
   * deixaria o campo com nome diferente do que ele literalmente escreve na saída, que é a
   * confusão pior. O outro `label`, em `ConsumptionInterface`, é texto de tela.
   */
  readonly label: string | null;
  /**
   * O ambiente escolhido É produção?
   *
   * `false` quando o prompt só serve `staging`, `canary` ou similar. A aba se chama "Como consumir"
   * e o público é quem vai colar o trecho num serviço — publicar `staging` sem dizer que não é
   * produção é deixar o operador supor o contrário. Medido pelo `/review`.
   */
  readonly environmentIsProduction: boolean;
  readonly variables: readonly string[];
  readonly baseUrl: string;
}

/**
 * O endereço do prompt no trecho: o AMBIENTE quando existe, a versão quando não.
 *
 * O consumidor de produção quer o ponteiro móvel — é o que a promoção existe para dar, e o que o
 * M20 estendeu para a composição. Gerar `version: 7` fixo ensina a congelar, e o congelamento é
 * exatamente o que a promoção evita. Sem ambiente algum, a versão é o único endereço honesto que
 * sobra: omitir os dois resolveria "a mais recente", que muda debaixo do consumidor sem aviso.
 */
function sdkAddress(target: Target): string {
  return target.label !== null
    ? `label: '${target.label}'`
    : `version: ${String(target.latestVersion)}`;
}

function restAddress(target: Target): string {
  return target.label !== null
    ? `label=${encodeURIComponent(target.label)}`
    : `version=${String(target.latestVersion)}`;
}

/**
 * O exemplo de valores — omitido quando o prompt não declara variável alguma.
 *
 * A opção chama-se **`vars`**, e a distinção custou um BLOCKER de review: `variables` existe no
 * contrato do SDK, mas é campo do RESULTADO (`Prompt.variables: string[]`, a lista de nomes que o
 * template declara), não das opções. Eu li o símbolo errado e gerei um trecho que, em TypeScript,
 * nem compila — e em JavaScript compila e **entrega o template cru ao modelo**, em silêncio.
 *
 * Fonte: `packages/sdk/src/index.ts:158` (`readonly vars?: Record<string, string>`).
 */
function sdkVariables(target: Target): string {
  if (target.variables.length === 0) return '';
  const pares = target.variables.map((v) => `    ${v}: '…',`).join('\n');
  return `,\n  vars: {\n${pares}\n  }`;
}

function gerarSdk(target: Target): string {
  // `resolve: true` SÓ quando o prompt compõe (`usetheoai/theo-promptly#84`, fechado).
  //
  // Até a v0.17.1 o SDK não tinha como pedir resolução, e este trecho carregava uma RESSALVA
  // apontando o REST. Agora ele pede — e `prompt.resolvedContent` traz o texto composto, enquanto
  // `content` mantém o marcador visível, que é o que torna a composição depurável.
  //
  // Só quando compõe, porque resolver custa a travessia do grafo: quem não referencia ninguém não
  // deve pagá-la (a mesma decisão de custo do DoD-5 do M20).
  const resolution = target.compoe ? ',\n  resolve: true' : '';
  const leitura = target.compoe
    ? 'console.log(prompt.resolvedContent ?? prompt.content);'
    : 'console.log(prompt.content);';
  return `import { PromptlyClient } from '@usetheo/promptly-sdk';

const promptly = new PromptlyClient({
  baseUrl: '${target.baseUrl}',
  // PLATFORM key (\`theo_live_…\`), created in Settings → API Tokens with the
  // \`promptly:read\` scope. The service key never crosses the edge. Never in code: export it.
  apiKey: process.env.THEO_API_KEY ?? '',
});

const prompt = await promptly.getPrompt('${target.name}', {
  ${sdkAddress(target)}${resolution}${sdkVariables(target)}
});

${leitura}`;
}

function gerarRest(target: Target): string {
  // O nome vai CODIFICADO: o M16 trouxe pastas, e `m16-sup/relatorio` é um nome. Sem codificar, a
  // barra vira segmento de caminho e a chamada bate em outro endereço — com 404, em silêncio.
  //
  // `resolve=true` SÓ quando o prompt compõe: resolver custa a travessia do grafo, e quem não
  // referencia ninguém não deve pagá-la (a mesma decisão de custo do DoD-5 do M20).
  const resolution = target.compoe ? '&resolve=true' : '';
  const caminho = `${target.baseUrl}/prompts/${encodeURIComponent(target.name)}?${restAddress(target)}${resolution}`;
  return `# PLATFORM key (theo_live_…), from Settings → API Tokens, with the promptly:read scope.
# Never pasted here — it comes from the environment.
curl -sS '${caminho}' \\
  -H "Authorization: Bearer \${THEO_API_KEY}"`;
}

function gerarMcp(target: Target): string {
  // O `/review` mediu que o bloco anterior se declarava `json` e NÃO era JSON (tinha `//`), nem era
  // a requisição JSON-RPC que o MCP fala, nem a configuração que aponta um cliente para o servidor.
  // Não havia o que executar — e a aba prometia "código que roda".
  //
  // Agora são as duas metades que faltavam, e o bloco é `text` porque contém as duas: a
  // configuração do cliente (JSON puro) e a chamada. Declarar `json` sobre um bloco que não é
  // analisável seria a mesma mentira de antes, com outra roupa.
  const args =
    target.label !== null
      ? `"name": "${target.name}", "label": "${target.label}"`
      : `"name": "${target.name}", "version": ${String(target.latestVersion)}`;
  return `1) Point your MCP client at the server — platform key (theo_live_…),
   from Settings → API Tokens, with the promptly:read scope:

{
  "mcpServers": {
    "theo-promptly": {
      "url": "${target.baseUrl}/mcp",
      "headers": { "Authorization": "Bearer \${THEO_API_KEY}" }
    }
  }
}

2) Chame a ferramenta \`get_prompt\`:

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_prompt",
    "arguments": { ${args} }
  }
}`;
}

/**
 * O trecho pronto para copiar.
 *
 * Nenhuma saída contém credencial nem placeholder com forma de credencial — um trecho é feito para
 * ser copiado, e um exemplo parecido com uma chave real convida a colar a chave real ali e
 * commitá-la.
 */
export function buildConsumptionSnippet(iface: ConsumptionInterface['id'], target: Target): string {
  if (iface === 'sdk') return gerarSdk(target);
  if (iface === 'rest') return gerarRest(target);
  return gerarMcp(target);
}
