import { ACCOUNTS_URL, API_URL, AUTH_URL } from '@/lib/http/config';

/**
 * isSafeRedirectUrl — OWASP A01 boundary helper for server-supplied
 * redirect URLs (e.g., Kratos 422 + redirect_browser_to).
 *
 * Plan v1.1 Phase 3 Task T3.3 / EC-2 absorption (open-redirect via
 * 422+redirect_to). Kratos itself enforces allowlisting at the config
 * level, but client-side defense-in-depth is canonical: a misconfigured
 * auth service OR an injected response cannot phishing-redirect the user.
 *
 * Allowlist rule:
 *   - URL parses successfully via `new URL(url)`, AND
 *   - protocol is `https:` (canonical hosts) OR matches `window.location.origin`, AND
 *   - origin is one of `SAFE_REDIRECT_ORIGINS` OR equals `window.location.origin`
 *
 * The allowlist is exported as a const for grep-auditability — code
 * review can verify the set without parsing the function body.
 */
/**
 * Origins the OPERATOR configured. `docker-entrypoint.sh` validates these and they are not
 * response-supplied, so they are a trust root in a way `flow.ui.action` never is. Without
 * them the boundary silently bricked login, verification and recovery on any deployment
 * whose auth host is not one of the six literals below — including
 * `https://accounts.usetheo.dev`, the topology `kratos.ts` documents in its own comment.
 */
function configuredOrigins(): string[] {
  const out: string[] = [];
  for (const raw of [API_URL, AUTH_URL, ACCOUNTS_URL]) {
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (u.protocol === 'https:' || u.protocol === 'http:') out.push(u.origin);
    } catch {
      // Not an absolute url — same-origin config, already covered.
    }
  }
  return out;
}

export const SAFE_REDIRECT_ORIGINS: readonly string[] = [
  // Dev-public canonical hosts (per Caddy / Cloudflare wildcard chain).
  'https://auth-dev.usetheo.dev',
  'https://app-dev.usetheo.dev',
  'https://cloud-dev.usetheo.dev',
  // Production hosts (future-ready; harmless on dev because window.origin won't match).
  'https://auth.usetheo.dev',
  'https://app.usetheo.dev',
  'https://cloud.usetheo.dev',
];

/**
 * B-031 — este guard SUBSUMIU `sanitizeReturnTo` (`lib/auth/return-to.ts`),
 * apagado em 2026-08-07.
 *
 * Os dois respondiam a mesma pergunta — "e seguro navegar para esta URL?" — com
 * formatos diferentes: aquele devolvia uma string ja saneada, com fallback para
 * `/projects`; este e um predicado e deixa a decisao com quem chama.
 *
 * Ter DUAS respostas para uma pergunta de seguranca e risco por si so: quem
 * chega pega a que encontrar primeiro, e as duas divergem em silencio ao longo
 * do tempo. Este ficou porque tem consumidor de producao (`device-verify.tsx`,
 * que antes navegava cru para uma URL vinda da resposta do servidor); o outro
 * nunca teve, e nao havia vetor ativo — medido duas vezes: os tres usos de
 * `return_to` no repo ESCREVEM a URL com o proprio origin, e nenhum LE uma
 * externa para navegar.
 *
 * ## A diferenca que nao pode se perder
 *
 * `sanitizeReturnTo` aceitava APENAS mesma origem. Este aceita tambem os hosts
 * canonicos de `SAFE_REDIRECT_ORIGINS` (Kratos publico) — necessario para o
 * fluxo de autenticacao, e mais permissivo do que aquele era.
 *
 * Se um dia alguem precisar sanear um `return_to` que chega de link externo
 * (e-mail, share), a pergunta a fazer NAO e "posso usar este guard?" e sim "o
 * allowlist de origens vale para ESTE destino?". Para um `return_to` pos-login,
 * provavelmente sim. Para um destino arbitrario, provavelmente nao — e ai o
 * certo e um segundo predicado com allowlist propria, nao afrouxar este.
 */
export function isSafeRedirectUrl(raw: string | null | undefined): boolean {
  if (raw == null || raw === '') return false;

  const url = analisar(raw);
  if (!url) return false;

  // B-214 — REGRA 1, e ela vem antes de qualquer permissão: nunca rebaixar o esquema. Uma página
  // servida em https que redireciona para http joga a navegação em texto claro, e o destino ser
  // confiável não muda isso.
  //
  // Este era o primeiro `if` do guarda, e ele tornava INALCANÇÁVEL o ramo logo abaixo que aceita
  // uma origem configurada em `http:` — escrito de propósito (`docker-entrypoint.sh` valida e
  // aceita `http://`), comentado como raiz de confiança, e morto em toda execução: numa página
  // https o `if` recusava antes, e numa página http a origem não batia por ser outro host. Um
  // ramo de segurança que nunca roda é pior que ausente: ele descreve uma proteção que não existe.
  //
  // A regra agora diz o que pretendia dizer — proibido DESCER de https para http — em vez de
  // "proibido http", que é o que ela fazia. Numa página http (dev local com o Kratos noutra
  // porta), um destino http configurado pelo operador passa. Numa página https, não passa nunca.
  if (url.protocol === 'http:' && httpsPage()) return false;

  return PERMISSOES.some((permitir) => permitir(url));
}

/**
 * `new URL` com base só quando a entrada COMEÇA com `/`.
 *
 * Sem base, `new URL('/device-success')` lança — um caminho relativo não tem origem — e o guarda
 * recusava o destino mais seguro que existe. Aplicar base a QUALQUER string seria o oposto:
 * `'not a url'` viraria `<origem>/not%20a%20url`, mesma origem e portanto "seguro", trocando uma
 * entrada malformada por uma navegação silenciosa para um 404.
 *
 * `//evil.com` também começa com `/` e recebe a base, de propósito: resolve para
 * `https://evil.com` e é recusado pela checagem de origem, que é onde essa decisão pertence. Não
 * existe atalho "começa com / logo é seguro" — a resolução acontece antes do julgamento, nunca no
 * lugar dele. (O e2e pegou o caso relativo em `device-verify.spec.ts:57`; os testes unitários não,
 * porque só exercitavam URLs absolutas.)
 */
function analisar(raw: string): URL | null {
  try {
    const base = raw.startsWith('/') && typeof window !== 'undefined' ? window.location.origin : undefined;
    return base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
}

function httpsPage(): boolean {
  // Sem `window` não há esquema de página para comparar, e um destino http não é julgável. Tratar
  // como https é a leitura conservadora: recusa.
  return typeof window === 'undefined' || window.location.origin.startsWith('https:');
}

/**
 * As três razões pelas quais um destino é aceito. Basta uma; a ordem entre elas não altera o
 * resultado, o que é justamente o que se quer de uma lista de permissões (a regra de recusa acima
 * é que é ordenada, e por isso mora fora daqui).
 */
const PERMISSOES: readonly ((url: URL) => boolean)[] = [
  // A própria origem, em qualquer esquema que a página já esteja usando.
  (url) => typeof window !== 'undefined' && url.origin === window.location.origin,

  // As origens que o OPERADOR configurou. `docker-entrypoint.sh` as valida e elas não vêm da
  // resposta do servidor, então são raiz de confiança de um jeito que `flow.ui.action` nunca é.
  // Sem elas o guarda bricava login, verificação e recuperação em qualquer deployment cujo host de
  // auth não fosse um dos seis literais de `SAFE_REDIRECT_ORIGINS` — incluindo
  // `https://accounts.usetheo.dev`, a topologia que `kratos.ts` documenta no próprio comentário.
  //
  // Sem verificação de protocolo aqui, e nem na regra seguinte: uma string de origem JÁ carrega o
  // esquema (`https://auth-dev.usetheo.dev`), então comparar origens rejeita `http://` pelo mesmo
  // ato. `javascript:` e `data:` produzem origem `'null'`, que não está em lista nenhuma. As
  // verificações que existiam aqui eram redundantes — provado por mutação: removê-las não mudava
  // nenhum resultado. O invariante que elas aparentavam proteger é da LISTA, e é lá que ele está
  // afirmado (`safe-redirect.test.ts`).
  (url) => configuredOrigins().includes(url.origin),

  // Os hosts canônicos.
  (url) => SAFE_REDIRECT_ORIGINS.includes(url.origin),
];
