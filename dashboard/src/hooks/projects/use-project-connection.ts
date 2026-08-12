import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/query-keys';
import { ApiError, engineFetch } from '@/lib/http/api';
import type { ProjectConnection } from '@/lib/api/types';
import {
  derivarConexaoEfetiva,
  derivarEstado,
  type EntradasDaFSM,
} from './connect-fsm';

const POLL_INTERVAL_MS = 2_000;

/**
 * A conexão de um projeto com o repositório do GitHub — leitura e polling.
 *
 * ## Por que existe (B-047)
 *
 * A página fazia isto à mão, com quatro peças coordenadas entre si: um
 * `useState` para o dado, outro para o carregando, um `useEffect` de busca
 * inicial, um `setInterval` de 2 s e um `useRef` guardando o fetch mais recente
 * — o ref existia só porque os efeitos de polling não podiam se reinscrever a
 * cada render sem reiniciar o timer.
 *
 * `refetchInterval` faz isso declarativamente, e o `queryKey` traz junto o que
 * nada disso tinha: invalidação. Antes, quem mudasse a conexão por outro
 * caminho não tinha como avisar esta tela.
 *
 * ## O 404 é resposta, não falha
 *
 * O backend devolve 404 + `NOT_CONNECTED` enquanto não existe linha em
 * `project_repositories`. "Ainda não conectado" é um fato sobre o projeto, e
 * vira `{ connected: false }`.
 *
 * Qualquer outro status sobe. Sem `throwOnError` — o estado anterior a B-047 —
 * o `engineFetch` devolvia `null` para os dois, e um 500 renderizava a tela de
 * "conecte seu repositório": o operador lia *"você não tem conexão"* quando a
 * verdade era *"não consegui perguntar"*. É a classe do `#274`, e
 * `silent-null-guard` acusou esta consulta no instante em que ela virou
 * `useQuery` — o defeito era mais velho que a migração, e invisível enquanto o
 * dado era buscado à mão.
 *
 * ## Por que o hook recebe as entradas da FSM
 *
 * Porque o polling só existe no estado `installing`, e esse estado depende
 * tanto do dado quanto de estado local da página (`busy`, o campo de repo, os
 * erros). Passá-las é o que permite ao `refetchInterval` decidir sozinho, sem
 * ler uma variável derivada da própria consulta — que estoura em runtime, já
 * que o TanStack avalia `refetchInterval` durante o hook.
 */
export function useConexaoDoProjeto(
  name: string,
  entradas: EntradasDaFSM & { installedQueryID: number | undefined },
) {
  const { installedQueryID, ...fsm } = entradas;

  return useQuery({
    queryKey: queryKeys.projects.conexao(name),
    queryFn: async (): Promise<ProjectConnection> => {
      try {
        const data = await engineFetch<ProjectConnection>(
          `/api/v1/projects/${encodeURIComponent(name)}/connect`,
          {},
          { throwOnError: true },
        );
        return data ?? { connected: false };
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return { connected: false };
        throw e;
      }
    },
    enabled: !!name,
    refetchInterval: (query) => {
      const efetiva = derivarConexaoEfetiva(query.state.data ?? null, installedQueryID);
      return derivarEstado(efetiva, fsm) === 'installing' ? POLL_INTERVAL_MS : false;
    },
  });
}
