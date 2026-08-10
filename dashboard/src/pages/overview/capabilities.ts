/**
 * As capacidades da plataforma, e como cada uma resume o seu estado (B-112).
 *
 * ## Por que este arquivo existe
 *
 * A tela `/` chamava-se Overview e era o overview de UM subsistema: consumia `useProjects`,
 * `useBuildStats` e billing, e nada mais. As oito capacidades que o menu declara não apareciam
 * nela. A assimetria que tornava isso caro: cada capacidade já tinha a SUA página de overview —
 * `lens/`, `memory/`, `promptly/`, `rag/` —, então a plataforma tinha sete overviews de
 * capacidade e nenhuma de plataforma. Quem chegava concluía, da tela inicial, que o produto é
 * um PaaS de deploy.
 *
 * ## O que NÃO está aqui, e por quê
 *
 * A lista de capacidades. Ela vive no registro do menu (`app-sidebar-menus.ts`), e este arquivo
 * apenas declara o SINAL de cada uma. Duas listas divergem — é uma questão de quando, não de
 * se —, e `capabilities.test.ts` reprova quando divergem: uma capacidade nova sem sinal, ou um
 * sinal apontando para capacidade que já saiu.
 *
 * O precedente é do próprio repositório: `LENS_CAPABILITIES` foi criado no M70 para que *"a
 * barra lateral e a grade da Overview nunca divirjam"*. Aqui a mesma forma sobe um nível.
 *
 * ## Por que um SINAL, e não só nome e link
 *
 * Um card de nome + link é a barra lateral desenhada de outro jeito: custa uma tela e não
 * responde nada que o menu já não responda (ladder de parcimônia, degrau 1). O que transforma a
 * lista em *overview* é o estado — **o que eu uso, e o que existe que eu não uso**.
 */

/**
 * O estado de uma capacidade na tela.
 *
 * Quatro, e discriminados no TIPO. A lição é de `B-111`, aplicada antes de o defeito existir:
 * aquele item nasceu de um código que decidia comportamento lendo texto de interface, e quebrou
 * em silêncio no dia em que as frases mudaram.
 *
 * `nao-lida` é o que mais importa manter separado de `nao-adotada`. Uma capacidade que aparece
 * como não adotada por causa de uma falha de leitura convida o usuário a concluir que ela não
 * serve para nada — e ele não volta para conferir.
 */
export type EstadoDaCapacidade = 'em-uso' | 'nao-adotada' | 'nao-lida' | 'em-breve';

/**
 * Como obter o sinal de uma capacidade.
 *
 * Duas formas, e a escolha entre elas foi MEDIDA, não preferida:
 *
 *   `contagem` — a capacidade já expõe um agregado que o backend serve, e o número é honesto.
 *   `presenca` — a capacidade só expõe lista. Aí a pergunta é "está em uso?", respondida com
 *                `limit=1`: contar por lista é pagar o transporte de N itens para saber se
 *                N > 0, na página mais visitada do produto.
 *
 * `presenca` mostra adoção e NÃO inventa quantidade. Um número que a tela não sabe é pior que a
 * ausência dele.
 */
export type SinalDaCapacidade =
  | {
      readonly tipo: 'contagem';
      readonly rota: string;
      /** O número de manchete. `null` quando a resposta chegou sem ele — que não é zero. */
      readonly extrair: (dados: unknown) => number | null;
      readonly unidade: string;
    }
  | {
      readonly tipo: 'presenca';
      readonly rota: string;
      readonly temAlgo: (dados: unknown) => boolean;
    }
  | { readonly tipo: 'em-breve' };

export interface Capacidade {
  /** A rota — é a chave que casa com o registro do menu. */
  readonly path: string;
  readonly label: string;
  /** Uma linha sobre o que a capacidade faz. Para quem ainda não a usa, é a única pista. */
  readonly resumo: string;
  readonly sinal: SinalDaCapacidade;
}

/** Lê um campo numérico de uma resposta desconhecida sem fingir que ela tem forma. */
function numero(dados: unknown, campo: string): number | null {
  if (typeof dados !== 'object' || dados === null) return null;
  const v = (dados as Record<string, unknown>)[campo];
  return typeof v === 'number' ? v : null;
}

function lista(dados: unknown, campo: string): unknown[] | null {
  if (typeof dados !== 'object' || dados === null) return null;
  const v = (dados as Record<string, unknown>)[campo];
  return Array.isArray(v) ? v : null;
}

/**
 * Os sinais, um por capacidade do registro.
 *
 * As ROTAS e os CAMPOS não foram escolhidos — foram lidos das páginas de capacidade, que já os
 * consomem. Inventar um contrato aqui seria fabricar: o backend não tem endpoint de overview de
 * plataforma, e supor a forma de um seria o tipo de suposição que este repositório trata como
 * defeito.
 *
 * As chaves de query são deliberadamente as MESMAS das páginas de capacidade
 * (`['cloud', rota]`), então abrir a Overview aquece o cache e clicar na capacidade renderiza
 * sem esperar — a requisição não é a mais, é mais cedo.
 *
 * UMA EXCEÇÃO, declarada em vez de escondida: `lens/overview.tsx:94` usa
 * `['cloud', rota, range]`. A Overview não tem `range`, então a chave dela não casa e o
 * aquecimento não vale para Observability. Preferi não replicar o `range` aqui: a Overview
 * mostraria um recorte que ela não deixa o usuário escolher, e um número cuja janela ninguém
 * declarou é o defeito que `tabs/producao.tsx` já documenta ("uma janela que não se declara faz
 * o operador atribuir o número ao período errado").
 */
export const CAPACIDADES: readonly Capacidade[] = [
  {
    path: '/memory',
    label: 'Memory',
    resumo: 'What your agents remember across conversations.',
    sinal: {
      tipo: 'contagem',
      rota: '/v1/dashboard/memory/metrics',
      extrair: (d) => numero(d, 'total_memories'),
      unidade: 'memories',
    },
  },
  {
    path: '/rag',
    label: 'Knowledge Base',
    resumo: 'Documents your agents retrieve from before answering.',
    sinal: {
      tipo: 'contagem',
      rota: '/v1/dashboard/rag/analytics',
      extrair: (d) => {
        if (typeof d !== 'object' || d === null) return null;
        const totals = (d as Record<string, unknown>).totals;
        return numero(totals, 'retrievals');
      },
      unidade: 'retrievals',
    },
  },
  {
    path: '/databases',
    label: 'Databases',
    resumo: 'Managed databases for your projects, with backup and restore.',
    // Anunciada e ainda não construída — a mesma decisão que o menu já tomou com `comingSoon`.
    // Anunciar antes do clique é mais barato que descobrir depois de navegar.
    sinal: { tipo: 'em-breve' },
  },
  {
    path: '/workspaces',
    label: 'Workspace',
    resumo: 'Files your agents read and write, per tenant.',
    sinal: {
      tipo: 'contagem',
      rota: '/v1/dashboard/storage/usage',
      extrair: (d) => numero(d, 'used_bytes'),
      unidade: 'bytes stored',
    },
  },
  {
    path: '/observability',
    label: 'Observability',
    resumo: 'Traces, latency and token cost of every agent run.',
    // `presenca` e não `contagem`: a resposta é uma série (`traffic`/`latency`/`tokensByModel`),
    // não um escalar. Somar os baldes para inventar uma manchete atribuiria ao número uma janela
    // que esta tela não declara.
    sinal: {
      tipo: 'presenca',
      rota: '/v1/dashboard/lens/observability',
      temAlgo: (d) => (lista(d, 'traffic')?.length ?? 0) > 0,
    },
  },
  {
    path: '/trust',
    label: 'Trust',
    resumo: 'What gets blocked in conversations, before it happens.',
    sinal: {
      tipo: 'presenca',
      rota: '/v1/dashboard/trust/guardrails?limit=1',
      temAlgo: (d) => (lista(d, 'guardrails')?.length ?? 0) > 0,
    },
  },
  {
    path: '/skills',
    label: 'Skills',
    resumo: 'Capabilities your agents can discover and load.',
    sinal: {
      tipo: 'presenca',
      rota: '/v1/dashboard/skills?limit=1',
      temAlgo: (d) => (lista(d, 'skills')?.length ?? 0) > 0,
    },
  },
  {
    path: '/promptly',
    label: 'Prompts',
    resumo: 'Versioned prompts resolved at runtime, with no redeploy.',
    sinal: {
      tipo: 'presenca',
      rota: '/v1/dashboard/promptly/prompts?limit=1',
      temAlgo: (d) => (lista(d, 'prompts')?.length ?? 0) > 0,
    },
  },
];

/**
 * O estado de uma capacidade a partir do que a consulta devolveu.
 *
 * A ordem dos testes É o contrato, e o primeiro é o que importa: **erro nunca vira zero**. Um
 * `nao-lida` renderizado como "não adotada" é a tela afirmando ausência a partir de ignorância —
 * a distinção que este repositório defende em toda superfície de leitura.
 */
export function estadoDaCapacidade(
  sinal: SinalDaCapacidade,
  consulta: { readonly falhou: boolean; readonly carregando: boolean; readonly dados: unknown },
): EstadoDaCapacidade | 'carregando' {
  if (sinal.tipo === 'em-breve') return 'em-breve';
  if (consulta.falhou) return 'nao-lida';
  if (consulta.carregando) return 'carregando';
  // Uma consulta assentada sem dado é uma leitura que FALHOU, não uma capacidade vazia — o
  // mesmo raciocínio de `system-status-indicator.tsx`, que trata `data == null` fora de
  // `isPending` como falha em vez de publicar "checando" para sempre.
  if (consulta.dados == null) return 'nao-lida';

  if (sinal.tipo === 'contagem') {
    const n = sinal.extrair(consulta.dados);
    if (n === null) return 'nao-lida';
    return n > 0 ? 'em-uso' : 'nao-adotada';
  }
  return sinal.temAlgo(consulta.dados) ? 'em-uso' : 'nao-adotada';
}
