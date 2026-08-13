/**
 * Validação das cargas que atravessam uma fronteira de EVENTO do browser (B-234, B-236).
 *
 * ## O defeito que este módulo fecha
 *
 * `api.ts` anotava um handler como `MessageEvent<AuthMessage>` e um `CustomEvent` como
 * `PlanLimitDetail`, e as duas anotações são afirmações de tempo de COMPILAÇÃO sobre dados que
 * chegam em tempo de EXECUÇÃO — de outra aba do navegador e do corpo de uma resposta HTTP. A
 * anotação faz o call site PARECER conferido enquanto não confere nada.
 *
 * O custo medido: uma mensagem `null` fazia `msg.type` lançar `TypeError` dentro do handler do
 * canal, onde não há `catch`; e um `current_plan` numérico chegava a `String.replace` dentro de um
 * handler do React, derrubando o modal.
 *
 * ## Por que um módulo e não dois `typeof` inline
 *
 * Os dois defeitos são a MESMA forma. Duas escadas `typeof` no lugar consertariam os dois casos
 * medidos e deixariam a forma livre para reaparecer na terceira fronteira — que é exatamente como
 * ela chegou a duas. Um nome torna a fronteira explícita e testável sem browser.
 *
 * Sem `zod`: o repositório não tem dependência de schema em runtime, e duas formas de quatro
 * campos não justificam adicionar uma (parsimony ladder, rung 4 → 2 — `typeof` é stdlib e basta).
 *
 * ## A disciplina
 *
 * `rules/error-handling.md § 2` — validar na fronteira; passada ela, o dado é confiável. As duas
 * fronteiras confiavam NA fronteira, que é o único lugar onde confiança não está disponível.
 * Permissivo com campos EXTRA, estrito com os campos que se lê: um emissor futuro que acrescente
 * um timestamp não pode deixar de deslogar esta aba.
 */

/** A única mensagem que o canal `theo-auth` transporta. Não carrega segredo — ver `api.ts`. */
export interface AuthMessage {
  readonly type: 'logged-out';
}

/**
 * O subconjunto do corpo de um 402 que o modal de upgrade de fato lê.
 *
 * Exatamente os campos consumidos por `PlanLimitUpgradeModal` — nem mais (o que não é lido não
 * precisa atravessar), nem menos (um campo lido e não validado é o defeito de novo).
 */
export interface PlanLimitDetail {
  readonly current_plan?: string;
  readonly code?: string;
  readonly message?: string;
  readonly resource?: string;
  readonly limit?: number;
}

/** Uma string presente e não-vazia; qualquer outra coisa é ausência. */
function usefulText(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : v;
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Esta mensagem de outra aba é, de fato, o sinal de logout?
 *
 * Um `false` aqui não é um erro a reportar: o canal é same-origin e qualquer código da origem pode
 * postar nele. O que este predicado garante é que só a forma conhecida dispare a ação
 * DESTRUTIVA do outro lado (zerar o token e redirecionar).
 */
export function isLoggedOutMessage(v: unknown): v is AuthMessage {
  return ehObjeto(v) && v.type === 'logged-out';
}

/**
 * Lê do corpo de um 402 apenas o que o modal consome, descartando o que não serve.
 *
 * `null` significa "não houve corpo" — o caminho não-JSON já emite isso e o modal tem texto para
 * ele. Um objeto cujos campos eram todos inúteis devolve `{}` e não `null`, porque "o servidor
 * respondeu com um corpo que não deu para usar" é um fato DIFERENTE de "não houve corpo", e
 * colapsar os dois perderia o primeiro.
 */
export function readPlanLimitDetail(v: unknown): PlanLimitDetail | null {
  if (!ehObjeto(v)) return null;
  const lido: { -readonly [K in keyof PlanLimitDetail]: PlanLimitDetail[K] } = {};
  for (const field of ['current_plan', 'code', 'message', 'resource'] as const) {
    const t = usefulText(v[field]);
    if (t !== undefined) lido[field] = t;
  }
  // `limit` é o único numérico: um `Infinity` ou `NaN` renderizaria como texto e não como limite.
  if (typeof v.limit === 'number' && Number.isFinite(v.limit)) lido.limit = v.limit;
  return lido;
}
