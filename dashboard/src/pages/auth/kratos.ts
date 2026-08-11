// Kratos self-service flow helpers.
// All flows go through the public Kratos API (accounts.{domain}).
// No internal terms (Kratos, Ory) are exposed to users.

// Prefer dedicated ACCOUNTS_URL (Kratos may live at accounts.theo.dev in prod
// while API lives at api.theo.dev). Falls back to API_URL for same-origin dev.
import { API_URL, ACCOUNTS_URL as CONFIG_ACCOUNTS_URL } from '@/lib/http/config';
export const ACCOUNTS_URL = CONFIG_ACCOUNTS_URL || API_URL;

export interface FlowNode {
  type: string;
  group: string;
  attributes: {
    name?: string;
    type?: string;
    value?: string;
    required?: boolean;
    disabled?: boolean;
    node_type?: string;
  };
  messages: { id: number; text: string; type: string }[];
  meta: { label?: { text: string } };
}

export interface Flow {
  id: string;
  type: string;
  state?: string;
  ui: {
    action: string;
    method: string;
    nodes: FlowNode[];
    messages?: { id: number; text: string; type: string }[];
  };
}

/**
 * Initiate a self-service flow (login, registration, recovery, verification, settings).
 *
 * B-169 — o ramo de 3xx era CÓDIGO MORTO, e o `redirect: 'manual'` era a causa.
 *
 * Sob `manual`, a spec do Fetch entrega uma resposta filtrada do tipo `opaqueredirect`: status 0,
 * lista de headers VAZIA. Então `resp.status >= 300` nunca era verdade, e `resp.headers.get
 * ('Location')` — se chegasse lá — devolveria `null` de qualquer jeito. O bloco inteiro afirmava
 * tratar o redirecionamento de fluxo do browser e não tratava nada; um leitor procurando onde o
 * 303 é seguido parava ali e concluía que estava resolvido.
 *
 * `redirect: 'follow'` é a forma que `login.tsx:92` e `register.tsx:116` já usam para o mesmo
 * serviço: o browser segue o 303 sozinho e o corpo do fluxo chega no 200. Com isso o ramo some
 * porque deixa de ser necessário, e não porque foi apagado — que é a diferença entre remover
 * código morto e remover uma funcionalidade.
 *
 * A metade de open-redirect deste item já estava fechada pelo `safeNavigator` (B-138), então nada
 * de segurança se perde: não há mais destino vindo de header para julgar.
 */
export async function initFlow(flowType: string): Promise<Flow> {
  const resp = await fetch(`${ACCOUNTS_URL}/self-service/${flowType}/browser`, {
    credentials: 'include',
    redirect: 'follow',
  });
  if (resp.ok) return resp.json();
  throw new FlowSubmitError(resp.status);
}

/** Get an existing flow by ID. */
export async function getFlow(flowType: string, flowId: string): Promise<Flow> {
  const resp = await fetch(flowUrl(ACCOUNTS_URL, flowType, flowId), {
    credentials: 'include',
  });
  if (!resp.ok) throw new Error(`Failed to get ${flowType} flow`);
  return resp.json();
}

/** Submit a flow (form action from flow.ui.action). */

/**
 * O endereço do fluxo Kratos, com o id CODIFICADO (B-213).
 *
 * O id vem de `searchParams.get('flow')` — uma entrada controlada por quem monta o link. Cru, um
 * `&` ou um `#` nele deixa de ser dado e vira ESTRUTURA: `?id=a&redirect_to=…` acrescenta um
 * parâmetro que ninguém escreveu, e o Kratos o lê como se fosse nosso.
 *
 * Uma função e não `encodeURIComponent` em cinco chamadas: eram cinco, e a sexta nasceria sem —
 * foi assim que estas cinco existiram. Aqui o encoding não é algo de que alguém precise lembrar.
 */
export function flowUrl(base: string, flowType: string, flowId: string): string {
  return `${base}/self-service/${flowType}/flows?id=${encodeURIComponent(flowId)}`;
}

/**
 * Uma recusa do SERVIÇO de identidade, distinta de uma recusa de VALIDAÇÃO (B-232).
 *
 * As duas chegam por HTTP e pedem coisas opostas de quem lê a tela: a validação diz o que corrigir
 * no formulário, a queda diz para tentar de novo mais tarde. Sem o status elas eram a mesma coisa.
 */
export class FlowSubmitError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`identity service refused the flow with status ${String(status)}`);
    this.name = 'FlowSubmitError';
    this.status = status;
  }
}

/**
 * Envia um fluxo do Kratos.
 *
 * B-232 — `resp.status` era descartado (`return resp.json()`), então um 500 devolvendo
 * `{"error": "..."}` saía daqui como se fosse um `Flow`. `getFlowMessages` tolera um `ui` ausente
 * — por bons motivos —, e o resultado era que uma queda do serviço de identidade não produzia
 * mensagem nenhuma na tela: indistinguível de "nada aconteceu".
 *
 * O `400` NÃO é erro aqui, e essa distinção é o cuidado que este conserto exige. O Kratos responde
 * 400 com o fluxo INTEIRO quando um campo é inválido; é assim que a tela mostra "senha muito
 * curta". Tratá-lo como falha quebraria o caminho normal de validação.
 */
export async function submitFlow(action: string, method: string, body: Record<string, string>): Promise<Flow> {
  const resp = await fetch(action, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  // 4xx que não seja 400 (401/403/404/410 — fluxo expirado, CSRF recusado) e todo 5xx são recusas
  // do serviço, não do formulário.
  if (!resp.ok && resp.status !== 400) throw new FlowSubmitError(resp.status);
  return resp.json();
}

/** Extract CSRF token from a flow. */
export function getCsrfToken(flow: Flow): string {
  const node = flow.ui.nodes.find(n => n.attributes.name === 'csrf_token');
  return node?.attributes.value || '';
}

/** Extract flow-level error messages. Tolerates Kratos error responses
 * that don't have a `ui` field (e.g., 422 with redirect_browser_to). */
export function getFlowMessages(flow: Flow): string[] {
  return (flow?.ui?.messages || []).map(m => m.text);
}

/** Extract field-level error messages for a specific input. Null-safe. */
export function getFieldErrors(flow: Flow, fieldName: string): string[] {
  const node = flow?.ui?.nodes?.find(n => n.attributes.name === fieldName);
  return (node?.messages || []).filter(m => m.type === 'error').map(m => m.text);
}

/**
 * T0.1 EC-02 — enrich generic Kratos error messages with TCIA action context.
 *
 * Kratos sometimes returns generic phrases ("An unexpected error occurred",
 * "Internal server error") that lack the Action step required by sponsor
 * critério #6. This helper detects generic phrases and appends a context-
 * specific Action sentence. Specific Kratos messages (e.g., "Invalid email")
 * pass through unchanged — they're already actionable.
 */
const GENERIC_KRATOS_PHRASES = [
  'an unexpected error occurred',
  'internal server error',
  'something went wrong',
  'an error occurred',
];

type KratosErrorContext = 'login' | 'recovery' | 'verification' | 'registration';

const ACTION_BY_CONTEXT: Record<KratosErrorContext, string> = {
  login: 'Check your credentials and retry, or contact support@usetheo.dev if it persists.',
  recovery: 'Check your email address and network connection, then retry.',
  verification: 'Request a new verification link from the sign-in page.',
  registration: 'Check your inputs and retry, or contact support if it persists.',
};

export function enrichKratosError(rawMessage: string, context: KratosErrorContext): string {
  if (!rawMessage) return rawMessage;
  const lower = rawMessage.toLowerCase();

  // EC-2 / D8 (J-04 plan 2026-06-05): Kratos `identifier_similarity_check_enabled`
  // produces messages like "the password is too similar to the user identifier".
  // Replace with product-language WITHOUT leaking "identifier similarity" /
  // "Kratos" / "credential" to UI (Rule 3).
  if (lower.includes('similar to the user identifier') || lower.includes('identifier similarity')) {
    return "Choose a password that doesn't contain your email or username.";
  }

  // Red Team theo-cloud#75 closure: the duplicate-account error from
  // Kratos is "An account with the same identifier (email, phone,
  // username, ...) exists already." — but the /register form only
  // collects Name + Email + Password. Override the message with copy
  // scoped to the field the user actually filled in. Detection works
  // on a contiguous substring so locale/wording variants still match.
  if (
    lower.includes('account with the same identifier') ||
    lower.includes('an account with this email')
  ) {
    return 'An account with this email already exists. Sign in instead, or reset your password if you forgot it.';
  }

  const isGeneric = GENERIC_KRATOS_PHRASES.some((p) => lower.includes(p));
  if (!isGeneric) return rawMessage;
  return `${rawMessage}. ${ACTION_BY_CONTEXT[context]}`;
}
