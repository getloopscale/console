import type { ElementType } from 'react';
import { LENS_SIDEBAR_GROUPS } from '@/components/layout/lens-capabilities';
import {
  Activity,
  Bell,
  BookOpen,
  Boxes,
  Database,
  Brain,
  FilePlus,
  FileText,
  FlaskConical,
  FolderKanban,
  FolderTree,
  Github,
  Globe,
  History,
  Key,
  KeyRound,
  LayoutGrid,
  List,
  Link2,
  ListChecks,
  Lock,
  Network,
  Plug,
  Receipt,
  Rocket,
  ScrollText,
  Package,
  Search,
  Settings,
  Share2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  User,
  Users,
  Webhook,
} from 'lucide-react';

/**
 * A NAVEGACAO COMO DADO — a tabela de menus e a resolucao rota -> menu ativo.
 *
 * Extraido de `app-sidebar.tsx` porque sao duas responsabilidades: aqui esta O QUE o produto
 * oferece; la esta COMO isso e renderizado e operado. Separa-las tambem torna
 * `resolveActiveMenu` testavel diretamente — antes so dava para exercita-la atraves do render,
 * e foi justamente uma lacuna dela (a rota /trust ausente) que deixou quatro telas orfas.
 */

export interface MenuItem {
  label: string;
  path: string;
  icon: ElementType;
  /** When set, clicking the item replaces the sidebar contents with the
   * referenced submenu (Vercel drill-down pattern). The route is also
   * navigated so URL stays in sync. */
  drillsInto?: string;
  /**
   * Marca a capacidade como ANUNCIADA e ainda não construída. A entrada continua
   * navegável — a rota renderiza `SubPagePlaceholder`, que diz o que a tela fará
   * e o que dá para fazer hoje.
   *
   * Existe porque o padrão anterior (entrada normal + página placeholder) só
   * revela o estado DEPOIS do clique. Para uma lista de capacidades de topo isso
   * é caro: quem avalia o produto conta o que está pronto pelo menu, e uma
   * entrada indistinguível das outras infla essa conta. O marcador é a diferença
   * entre anunciar um roadmap e afirmar uma entrega.
   *
   * O rótulo é anunciado por leitor de tela junto do nome — um selo só visual
   * reintroduziria a mesma mentira para quem não o vê.
   */
  comingSoon?: boolean;
}

interface MenuGroup {
  /** Optional uppercase section title rendered above the group's items
   * (e.g., "Billing", "Developer"). Omit for an untitled cluster — visually
   * still separated from the next group by Sidebar.Section spacing. */
  title?: string;
  items: MenuItem[];
}

export interface MenuDefinition {
  id: string;
  /** Title shown in the back-button header of the submenu. */
  title: string;
  parent?: string;
  /** Groups render as separate Sidebar.Section blocks; this is the Vercel
   * pattern of clustering related items under labeled subheadings instead
   * of one flat list. */
  groups: MenuGroup[];
}

/**
 * Menu registry — drill-down sidebar (Vercel pattern, 2026-05-26).
 *
 * `main` is the root; submenus reference a `parent` so the back-button knows
 * where to return. URL pathnames drive which menu is active (no manual stack
 * state — URL is the source of truth), which means browser back/forward also
 * navigates the sidebar correctly.
 *
 * Each menu is broken into `groups`, each rendered as its own Sidebar.Section
 * (with optional title). This preserves the original "Billing" / footer-nav
 * separation that flat lists lose.
 *
 * Adding a new submenu:
 *   1. Add the menu definition here (id, groups, parent='main')
 *   2. Mark the parent item with `drillsInto: '<id>'`
 *   3. Add route patterns in app.tsx so `/<base>/*` resolves
 *   4. Extend resolveActiveMenu() — MANDATORY for any capability with its own base
 *      path. Skip it and the submenu exists in full but NEVER opens: only a typed URL
 *      reaches it, which is the one path a real user does not have (cost M24).
 */
export const MENUS: Record<string, MenuDefinition> = {
  main: {
    id: 'main',
    title: 'LoopScale',
    groups: [
      {
        items: [
          { label: 'Overview', path: '/', icon: LayoutGrid },
          { label: 'Projects', path: '/projects', icon: FolderKanban },
          // M20: Environments removed from the top-level nav — they are a project
          // dimension, managed under /projects/:name/environments (not global).
          { label: 'Domains', path: '/domains', icon: Globe },
          { label: 'Team', path: '/team', icon: Users },
        ],
      },
      {
        // The LoopScale data-plane capabilities (Memory / Knowledge Base / Observability), grouped under one
        // semantic header instead of three single-item groups whose title repeated the item
        // label. Each item drills into its own submenu (memory / rag / lens).
        title: 'Capabilities',
        items: [
          { label: 'Memory', path: '/memory', icon: Brain, drillsInto: 'memory' },
          { label: 'Knowledge Base', path: '/rag', icon: BookOpen, drillsInto: 'rag' },
          // Databases — ANUNCIADA, nao entregue. `loopscale-db` existe como produto
          // (extensao PostgreSQL) e nao tem superficie alguma no dashboard: nem
          // rota, nem endpoint, nem comando de CLI que a tela pudesse oferecer.
          // Por isso o placeholder NAO sugere comando — inventar um seria pior
          // que omitir.
          //
          // PLACEHOLDER · revisar ate 2026-11-07. Na revisao, ou vira
          // implementacao ou sai JUNTO com a rota: uma entrada de menu sem data
          // vira promessa para quem le o menu, que e o defeito que o marcador
          // `comingSoon` existe para evitar.
          { label: 'Databases', path: '/databases', icon: Database, comingSoon: true },
          { label: 'Workspace', path: '/workspaces', icon: FolderTree },
          { label: 'Observability', path: '/observability', icon: Activity, drillsInto: 'lens' },
          // M23 — a capacidade trust. Sem esta entrada as rotas /trust existem e ninguém as
          // alcança pela navegação: o serviço registrava violações que só apareciam por `curl`.
          { label: 'Trust', path: '/trust', icon: ShieldCheck, drillsInto: 'trust' },
          // M26 — PEÇA 1 de 3. A capacidade skills. Até aqui o único item chamado "Skills" no
          // menu inteiro era o de `/memory/skills`, que é do loopmem: quem procurava o
          // registro chegava no produto errado, sem erro algum. As outras duas peças são o
          // objeto `skills:` abaixo e a linha em `resolveActiveMenu` — as três, ou nenhuma.
          { label: 'Skills', path: '/skills', icon: Boxes, drillsInto: 'skills' },
          // M25 — PEÇA 1 de 3. A capacidade de prompts. O serviço está no ar desde sempre e a
          // promessa dele — promover uma revisão entre ambientes sem redeploy — só existia por
          // `curl`, SDK ou MCP: não havia entrada alguma no menu para quem opera. As outras duas
          // peças são o objeto `promptly:` abaixo e a linha em `resolveActiveMenu` — as três, ou
          // nenhuma.
          { label: 'Prompts', path: '/promptly', icon: FileText, drillsInto: 'promptly' },
        ],
      },
      {
        // Top-level shortcut to the API Tokens page (also reachable via
        // Settings → Developer → API Tokens). Uses the /tokens route so the
        // root sidebar stays active instead of drilling into Settings.
        title: 'Developer',
        items: [{ label: 'API Tokens', path: '/tokens', icon: KeyRound }],
      },
      {
        title: 'Billing',
        items: [{ label: 'Billing', path: '/billing', icon: Receipt }],
      },
      {
        title: 'Activity',
        items: [{ label: 'Audit log', path: '/audit', icon: History }],
      },
      {
        items: [
          { label: 'Settings', path: '/settings', icon: Settings, drillsInto: 'settings' },
          { label: 'Profile', path: '/profile', icon: User, drillsInto: 'profile' },
        ],
      },
    ],
  },
  settings: {
    id: 'settings',
    title: 'Settings',
    parent: 'main',
    groups: [
      {
        title: 'Workspace',
        items: [
          { label: 'General', path: '/settings', icon: Settings },
          // B-076 — apontam para as telas REAIS, nao para os placeholders de
          // `/settings/members` e `/settings/billing`.
          //
          // Medido em 2026-08-08: o menu tinha DUAS entradas 'Billing' — uma
          // para `/billing`, que funciona, e outra para `/settings/billing`,
          // que renderiza "ainda nao construida". E 'Members' levava a um
          // placeholder enquanto 'Team' (no menu principal) ja mostrava a
          // mesma coisa funcionando. Quem clicava nao tinha como saber qual
          // das duas era a real, e metade das vezes concluia que a
          // funcionalidade nao existe.
          { label: 'Members', path: '/team', icon: Users },
          { label: 'Billing', path: '/billing', icon: Receipt },
        ],
      },
      {
        title: 'Developer',
        items: [
          { label: 'API Tokens', path: '/settings/tokens', icon: Key },
          { label: 'Webhooks', path: '/settings/webhooks', icon: Webhook },
          { label: 'Notifications', path: '/settings/notifications', icon: Bell, comingSoon: true },
        ],
      },
      {
        items: [
          { label: 'Danger Zone', path: '/settings/danger', icon: ShieldAlert, comingSoon: true },
        ],
      },
    ],
  },
  profile: {
    id: 'profile',
    title: 'Profile',
    parent: 'main',
    groups: [
      {
        title: 'Personal',
        items: [
          { label: 'Account', path: '/profile', icon: User },
          { label: 'Security', path: '/profile/security', icon: Lock, comingSoon: true },
          { label: 'Sessions', path: '/profile/sessions', icon: Link2, comingSoon: true },
        ],
      },
      {
        items: [
          { label: 'Danger Zone', path: '/profile/danger', icon: ShieldAlert, comingSoon: true },
        ],
      },
    ],
  },
  // Memory drill-down — Plan 1 ships Overview + Memories; Plan 2 will add
  // Entities; Plan 3 will add Exports + Webhooks. Items added to this menu in
  // subsequent plans do NOT reflow the root sidebar — that's why we drill.
  rag: {
    id: 'rag',
    title: 'Knowledge Base',
    parent: 'main',
    groups: [
      {
        items: [
          { label: 'Overview', path: '/rag', icon: LayoutGrid },
          { label: 'Collections', path: '/rag/collections', icon: Boxes },
          { label: 'Connectors', path: '/rag/connectors', icon: Plug },
          { label: 'Documents', path: '/rag/documents', icon: ScrollText },
          { label: 'Wiki', path: '/rag/wiki', icon: BookOpen },
          { label: 'Ask', path: '/rag/ask', icon: Search },
          { label: 'GraphRAG', path: '/rag/graphrag', icon: Network },
          { label: 'Analytics', path: '/rag/analytics', icon: Activity },
        ],
      },
    ],
  },
  lens: {
    id: 'lens',
    title: 'Observability',
    parent: 'main',
    // M59 P4 — grouped nav IA (Arize's Observe → Evaluate → Improve narrative, blueprint §3).
    // M70 — the groups are now derived from the ONE `LENS_CAPABILITIES` registry so the sidebar and
    // the Overview "Explore" grid can never drift (the audit found Alerts routed but absent here).
    groups: LENS_SIDEBAR_GROUPS.map((g) => ({
      title: g.title,
      items: g.items.map((i) => ({ label: i.label, path: i.path, icon: i.icon })),
    })),
  },
  // M23 — o submenu da capacidade trust. Duas superfícies de LEITURA; a gestão de validators
  // entra em M24 com escopo próprio, e não aqui.
  trust: {
    id: 'trust',
    title: 'Trust',
    parent: 'main',
    groups: [
      {
        items: [
          { label: 'Overview', path: '/trust', icon: LayoutGrid },
          { label: 'Violations', path: '/trust/violations', icon: ShieldAlert },
          // M24 — a gestão chegou: o operador cria e remove as próprias guardrails, e vê o
          // que o enforcement inline barrou. Sem estas entradas as rotas existem e ninguém
          // as encontra — foi um defeito real do M23, corrigido em 31521ed.
          { label: 'Guardrails', path: '/trust/guardrails', icon: ShieldCheck },
          { label: 'Enforcement', path: '/trust/enforcement', icon: ScrollText },
        ],
      },
    ],
  },
  // M26 — PEÇA 2 de 3. O submenu da capacidade skills.
  //
  // Um item só, e isso é honesto e não preguiça: as outras duas telas da jornada — o detalhe e
  // as versões/canais — são POR SKILL, alcançadas a partir da lista. Inventar entradas de menu
  // para elas exigiria um identificador que o menu não tem, e o item levaria a lugar nenhum.
  skills: {
    id: 'skills',
    title: 'Skills',
    parent: 'main',
    groups: [
      {
        items: [
          { label: 'Overview', path: '/skills', icon: LayoutGrid },
          // M31 — a descoberta ENTRA no menu porque é ação do workspace, e porque é a razão de
          // existir do produto: até aqui a única jornada sem tela alguma.
          // M33 — o catálogo, para quem NÃO SABE o que procurar. Vem antes da Descoberta no
          // menu porque é a porta de quem chega sem uma intenção formada.
          { label: 'Catalog', path: '/skills/catalog', icon: LayoutGrid },
          { label: 'Discovery', path: '/skills/discovery', icon: Search },
          // M31 — autorar é ação do WORKSPACE, não de uma skill: o autor chega aqui sem ter
          // escolhido nenhuma. Por isso entra no menu, ao contrário do detalhe.
          { label: 'New skill', path: '/skills/new', icon: FilePlus },
          // M35 — a distribuição ENTRA no menu porque é ação do workspace, não de uma skill: o
          // operador chega nela sem ter escolhido uma skill antes. O detalhe de um pacote NÃO
          // entra, pela mesma razão que o detalhe de uma skill não entra — é POR PACOTE e se
          // alcança da lista.
          { label: 'Distribution', path: '/bundles', icon: Package },
        ],
      },
    ],
  },
  // M25 — PEÇA 2 de 3. O submenu da capacidade de prompts.
  //
  // Um item só, pela mesma razão do `skills:` acima: a outra tela da jornada — o detalhe, onde a
  // promoção acontece — é POR PROMPT, alcançada a partir da lista. Uma entrada de menu para ela
  // exigiria um nome que o menu não tem, e levaria a lugar nenhum.
  promptly: {
    id: 'promptly',
    title: 'Prompts',
    parent: 'main',
    groups: [
      {
        items: [
          // M13: a raiz virou o PAINEL, como em memory/rag/lens. Até aqui o rótulo dizia
          // `Overview` sobre uma tabela — prometia painel e entregava lista.
          { label: 'Overview', path: '/promptly', icon: LayoutGrid },
          // M13: o catálogo saiu da raiz e ganhou endereço próprio. Sem esta entrada ele só seria
          // alcançável pelo botão do painel — e um item de menu é o caminho de volta que todo
          // formulário precisa ter.
          { label: 'Catalog', path: '/promptly/catalog', icon: List },
          // M12: autorar é ação do workspace, não de um prompt — por isso ENTRA no menu, onde
          // comparar e promover não entram: essas duas são POR PROMPT e se alcançam do detalhe
          // (o catálogo oferece o atalho de comparar em cada linha desde o M13).
          { label: 'New revision', path: '/promptly/new', icon: FilePlus },
          // M12: autorar é ação do workspace, não de um prompt — por isso ENTRA no menu, onde
          // comparar e promover não entram: essas duas são POR PROMPT e se alcançam do detalhe.
        ],
      },
    ],
  },
  memory: {
    id: 'memory',
    title: 'Memory',
    parent: 'main',
    groups: [
      {
        items: [
          { label: 'Overview', path: '/memory', icon: LayoutGrid },
          { label: 'Memories', path: '/memory/memories', icon: ListChecks },
          // episodes-gateway-dashboard — cursor-paginated, bi-temporal (asOf)
          // event timeline over the subject's memories.
          { label: 'Episodes', path: '/memory/episodes', icon: History },
          // remember / recall / reflect live surface.
          { label: 'Playground', path: '/memory/playground', icon: FlaskConical },
          // Plan 2 — Memory Insights. Plan 3 will add Exports + Webhooks
          // here without reflowing the root sidebar.
          { label: 'Entities', path: '/memory/entities', icon: Users },
          // loopmem-graph-gateway-dashboard — entity relation graph view.
          { label: 'Graph', path: '/memory/graph', icon: Share2 },
          // dashboard-phase2b-skills-browse — read-only Repo-tier skill library.
          { label: 'Skills', path: '/memory/skills', icon: Boxes },
          // Plan 3 — Memory Operations.
          { label: 'Exports', path: '/memory/exports', icon: BookOpen },
          { label: 'Webhooks', path: '/memory/webhooks', icon: Webhook },
        ],
      },
    ],
  },
  // Project drill-down — Vercel/Linear pattern. When user enters /projects/<name>
  // (or any /projects/<name>/* sub-route), sidebar swaps to this menu. Items use
  // {project} placeholder, resolved at render time to the active project name
  // from URL. Title is also dynamic (shows the project name).
  project: {
    id: 'project',
    title: '{project}',
    parent: 'main',
    groups: [
      {
        items: [
          { label: 'Overview', path: '/projects/{project}', icon: LayoutGrid },
          { label: 'Deployments', path: '/projects/{project}/deployments', icon: Rocket },
          // M20: environments as a project dimension — discoverable in the project
          // sub-nav next to Deployments (you deploy INTO an environment).
          { label: 'Environments', path: '/projects/{project}/environments', icon: Boxes },
          { label: 'Status', path: '/projects/{project}/status', icon: Activity },
          { label: 'Runtime logs', path: '/projects/{project}/logs', icon: ScrollText },
          { label: 'Scale', path: '/projects/{project}/scale', icon: SlidersHorizontal },
          { label: 'Readiness', path: '/projects/{project}/readiness', icon: ShieldCheck },
        ],
      },
      {
        title: 'Configuration',
        items: [
          { label: 'Secrets', path: '/projects/{project}/secrets', icon: KeyRound },
          { label: 'Repository', path: '/projects/{project}/connect', icon: Github },
        ],
      },
    ],
  },
};

interface ResolvedMenu {
  id: string;
  /** Set when active menu is project-scoped — used to resolve {project} placeholders. */
  projectName?: string;
}

// Reserved project slugs that should NOT trigger drill-down (collide with
// future static routes like /projects/new). Mirrors EC-01 from plan v1.2.
const RESERVED_PROJECT_SLUGS = new Set(['new', 'create', 'admin']);

/** URL → active menu id + context. URL is source of truth (no manual stack state). */
export function resolveActiveMenu(pathname: string): ResolvedMenu {
  // Project drill-down: /projects/<name> or /projects/<name>/*
  // Explicitly does NOT match /projects (list page) — only when there's a name segment.
  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  if (projectMatch && !RESERVED_PROJECT_SLUGS.has(projectMatch[1])) {
    return { id: 'project', projectName: decodeURIComponent(projectMatch[1]) };
  }
  if (pathname.startsWith('/settings')) return { id: 'settings' };
  if (pathname.startsWith('/profile')) return { id: 'profile' };
  if (pathname.startsWith('/rag')) return { id: 'rag' };
  if (pathname.startsWith('/observability')) return { id: 'lens' };
  if (pathname.startsWith('/memory')) return { id: 'memory' };
  // M24 — sem esta linha o submenu `trust` existia inteiro, com as quatro telas, e NUNCA abria:
  // Guardrails e Enforcement só eram alcançáveis digitando a URL. Declarar o submenu não basta;
  // é aqui que a rota o ativa, e as duas metades vivem a 200 linhas uma da outra.
  if (pathname.startsWith('/trust')) return { id: 'trust' };
  // M26 — PEÇA 3 de 3, a que ninguém lembra e a que faz o menu ABRIR. Sem esta linha o submenu
  // `skills` existe inteiro e nunca aparece: as telas ficam alcançáveis só digitando a URL, que
  // é o único caminho que o usuário real não tem. Foi exatamente esta omissão que custou o M23.
  // M35 — `/bundles` pertence à capacidade Skills, embora o caminho não comece com `/skills`.
  // Sem esta linha o submenu não abre ao navegar para a distribuição, e a tela fica alcançável
  // apenas digitando a URL — que é exatamente o caminho que o usuário real não tem. Foi o defeito
  // que o loopguardrails levou três rodadas de validação para descobrir.
  if (pathname.startsWith('/bundles')) return { id: 'skills' };
  if (pathname.startsWith('/skills')) return { id: 'skills' };
  // M25 — PEÇA 3 de 3, a que ninguém lembra e a que faz o menu ABRIR. Sem esta linha o submenu
  // `promptly` existe inteiro e nunca aparece: o catálogo e o detalhe ficam alcançáveis só
  // digitando a URL — o único caminho que o usuário real não tem. Mesma omissão que custou o M23.
  //
  // M13 — a comparação respeita a FRONTEIRA do segmento. `startsWith('/promptly')` casava também
  // `/promptlyfoo`, que ativaria este submenu numa rota de outra capacidade. Não existe rota assim
  // hoje; a precisão custa dois caracteres e fecha a classe antes que exista uma.
  if (pathname === '/promptly' || pathname.startsWith('/promptly/')) return { id: 'promptly' };
  return { id: 'main' };
}

/** Substitute {project} placeholder in path/title with the active project name. */
export function resolvePlaceholders(value: string, projectName?: string): string {
  if (!projectName) return value;
  return value.replace(/\{project\}/g, encodeURIComponent(projectName));
}
