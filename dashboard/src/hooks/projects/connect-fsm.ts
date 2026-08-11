import type { ProjectConnection } from '@/lib/api/types';

/**
 * Os estados do fluxo de conexão com o GitHub.
 *
 * Mora aqui, e não na página, porque quem os PRODUZ é `derivarEstado`. Enquanto
 * o tipo ficou na página, este módulo tinha de importá-lo de volta — uma seta
 * de tipo em direção contrária à de código, que o `madge` não acusa (import de
 * tipo some na compilação) e que teria virado ciclo real no dia em que alguém
 * precisasse de um valor junto.
 *
 * E o MÓDULO inteiro desceu de `pages/projects/` para cá pela mesma razão, uma
 * camada acima: o `useConexaoDoProjeto` precisa da FSM, e um hook importando de
 * `pages/` inverte a direção das camadas. O `no-restricted-imports` acusou, e a
 * própria mensagem dele dizia a saída. É o `ADR-0001 D4.1`: quando residência e
 * camada colidem, a camada vence.
 */
export type ConnectState =
  | 'idle'
  | 'installing'
  | 'has_installation'
  | 'connected'
  | 'error';

/**
 * B-047 — a derivação da FSM, como função pura de módulo.
 *
 * Ela saiu de dentro do componente porque passou a ter DOIS chamadores: o
 * `useMemo` que produz `state` para a renderização, e o `refetchInterval` do
 * `useQuery`, que precisa da mesma resposta para decidir se continua buscando.
 *
 * Sem isso o `refetchInterval` teria de ler `state` — um `const` declarado
 * depois da consulta, porque deriva dela. Não é só ordem de linhas: o TanStack
 * avalia `refetchInterval` DURANTE o hook, então a leitura estoura em runtime
 * com `Cannot access 'state' before initialization`, e o tsc não acusa.
 *
 * A alternativa era repetir as cinco condições no `refetchInterval`. Aí a regra
 * de "quando estamos instalando" teria dois donos, e o dia em que um mudasse
 * sem o outro produziria polling que não para — ou uma tela que espera para
 * sempre por um tique que ninguém agenda.
 */
export function derivarConexaoEfetiva(
  conn: ProjectConnection | null,
  installedQueryID: number | undefined,
): ProjectConnection | null {
  if (!conn) {
    // Resposta ainda em voo, mas o id do install já veio na URL? Renderiza o
    // seletor sem esperar.
    if (installedQueryID) return { connected: false, installation_id: installedQueryID };
    return null;
  }
  if (conn.installation_id || conn.connected) return conn;
  if (installedQueryID) return { ...conn, installation_id: installedQueryID };
  return conn;
}

export interface EntradasDaFSM {
  busy: boolean;
  repoUrl: string;
  connectError: string | null;
  installError: string | null;
}

export function derivarEstado(
  effectiveConn: ProjectConnection | null,
  { busy, repoUrl, connectError, installError }: EntradasDaFSM,
): ConnectState {
  if (!effectiveConn) return 'idle';
  if (effectiveConn.connected) return 'connected';
  if (effectiveConn.installation_id) return 'has_installation';
  if (busy && repoUrl === '' && connectError === null && installError === null) {
    return 'installing';
  }
  return 'idle';
}
