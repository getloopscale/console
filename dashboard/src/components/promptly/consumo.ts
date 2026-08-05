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
export interface InterfaceDeConsumo {
  readonly id: 'sdk' | 'rest' | 'mcp';
  readonly rotulo: string;
  /** A linguagem do bloco, para o realce e para o rótulo de cópia. */
  readonly linguagem: 'typescript' | 'bash' | 'json';
}

export const INTERFACES: readonly InterfaceDeConsumo[] = [
  { id: 'sdk', rotulo: 'SDK (TypeScript)', linguagem: 'typescript' },
  { id: 'rest', rotulo: 'REST (curl)', linguagem: 'bash' },
  { id: 'mcp', rotulo: 'MCP', linguagem: 'json' },
];

/** O prompt para o qual o trecho é gerado. */
export interface Alvo {
  readonly nome: string;
  /**
   * Este prompt referencia outros? (M20)
   *
   * Decide se o trecho pede **resolução**. Um prompt que compõe, lido sem resolver, devolve o
   * marcador LITERAL — e o consumidor o manda ao modelo achando que mandou a política. É o desfecho
   * que o módulo de resolução chama de o pior: o prompt "funciona" e produz lixo.
   */
  readonly compoe: boolean;
  readonly ultimaVersao: number;
  /**
   * O ambiente que este prompt serve, quando serve algum.
   *
   * `null` é um fato — "nenhum ambiente aponta para este prompt" —, e não uma ausência de dado. A
   * distinção decide o trecho: com ambiente, ele usa o ponteiro móvel; sem, usa a versão.
   */
  readonly label: string | null;
  readonly variaveis: readonly string[];
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
function enderecoSdk(alvo: Alvo): string {
  return alvo.label !== null
    ? `label: '${alvo.label}'`
    : `version: ${String(alvo.ultimaVersao)}`;
}

function enderecoRest(alvo: Alvo): string {
  return alvo.label !== null
    ? `label=${encodeURIComponent(alvo.label)}`
    : `version=${String(alvo.ultimaVersao)}`;
}

/** O exemplo de variáveis — omitido quando o prompt não declara nenhuma (ruído que se interpreta). */
function variaveisSdk(alvo: Alvo): string {
  if (alvo.variaveis.length === 0) return '';
  const pares = alvo.variaveis.map((v) => `    ${v}: '…',`).join('\n');
  return `,\n  variables: {\n${pares}\n  }`;
}

function gerarSdk(alvo: Alvo): string {
  // A ressalva é OBRIGATÓRIA quando o prompt compõe: o SDK ainda não pede resolução, então o
  // `content` vem com o marcador literal. Omiti-la entregaria um trecho que roda e produz lixo —
  // e o consumidor não teria como saber. Ver `usetheoai/theo-promptly#84`.
  const ressalva = alvo.compoe
    ? `
// ATENÇÃO — este prompt referencia outros, e o SDK ainda não resolve a composição:
// \`prompt.content\` virá com os marcadores \`@@@promptly:…@@@\` literais.
// Enquanto o SDK não expõe a resolução, use o trecho REST desta aba, que já a pede.
`
    : '';
  return `import { PromptlyClient } from '@usetheo/promptly-sdk';
${ressalva}
const promptly = new PromptlyClient({
  baseUrl: '${alvo.baseUrl}',
  // Chave da PLATAFORMA (\`theo_live_…\`), criada em Settings → API Tokens com o escopo
  // \`promptly:read\`. A chave do serviço não passa pela borda. Nunca no código: exporte-a.
  apiKey: process.env.THEO_API_KEY ?? '',
});

const prompt = await promptly.getPrompt('${alvo.nome}', {
  ${enderecoSdk(alvo)}${variaveisSdk(alvo)}
});

console.log(prompt.content);`;
}

function gerarRest(alvo: Alvo): string {
  // O nome vai CODIFICADO: o M16 trouxe pastas, e `m16-sup/relatorio` é um nome. Sem codificar, a
  // barra vira segmento de caminho e a chamada bate em outro endereço — com 404, em silêncio.
  //
  // `resolve=true` SÓ quando o prompt compõe: resolver custa a travessia do grafo, e quem não
  // referencia ninguém não deve pagá-la (a mesma decisão de custo do DoD-5 do M20).
  const resolucao = alvo.compoe ? '&resolve=true' : '';
  const caminho = `${alvo.baseUrl}/prompts/${encodeURIComponent(alvo.nome)}?${enderecoRest(alvo)}${resolucao}`;
  return `# Chave da PLATAFORMA (theo_live_…), de Settings → API Tokens, com escopo promptly:read.
# Nunca colada aqui — vem do ambiente.
curl -sS '${caminho}' \\
  -H "Authorization: Bearer \${THEO_API_KEY}"`;
}

function gerarMcp(alvo: Alvo): string {
  const args =
    alvo.label !== null
      ? `"name": "${alvo.nome}", "label": "${alvo.label}"`
      : `"name": "${alvo.nome}", "version": ${String(alvo.ultimaVersao)}`;
  return `// Ferramenta \`get_prompt\` do servidor MCP do theo-promptly.
{
  "tool": "get_prompt",
  "arguments": { ${args} }
}`;
}

/**
 * O trecho pronto para copiar.
 *
 * Nenhuma saída contém credencial nem placeholder com forma de credencial — um trecho é feito para
 * ser copiado, e um exemplo parecido com uma chave real convida a colar a chave real ali e
 * commitá-la.
 */
export function gerarTrechoDeConsumo(iface: InterfaceDeConsumo['id'], alvo: Alvo): string {
  if (iface === 'sdk') return gerarSdk(alvo);
  if (iface === 'rest') return gerarRest(alvo);
  return gerarMcp(alvo);
}
