import { Rocket } from 'lucide-react';
import { safeNavigator } from '@/lib/navigation';
import type { EmptyStateCopy } from '@/lib/list-state';

/**
 * O que a tela de deploys diz quando um projeto ainda não fez nenhum.
 *
 * ## Por que fora do JSX
 *
 * Um descritor de estado vazio é DADO — um ícone, um título, uma frase e uma ação. Ele estava
 * inline dentro do `PageShell`, com vinte linhas de comentário histórico no meio da árvore de
 * componentes, e a página passou do orçamento de LoC ao ganhar a perna de erro que faltava
 * (B-167). A catraca (B-009/B-033) não se levanta: ela manda decompor, e esta era a parte do
 * arquivo que menos tinha a ver com renderizar.
 *
 * Sair do JSX também o torna testável sem montar a página.
 */
export function noDeploysYet(projeto: string): EmptyStateCopy {
  return {
    icon: Rocket,
    // T4.3 finding 3.5: projeto frio — a afordância primária é conectar um repositório, e não
    // apenas mandar rodar um comando que a pessoa pode não estar pronta para rodar. O botão
    // Deploy do topo já está desabilitado neste estado.
    title: 'No deployments yet',
    // #121 — CTA centrada em deploy. O painel de conexão é a superfície certa quando a pessoa de
    // fato precisa conectar; o estado vazio de deploys não deve presumir desconexão.
    description: `Trigger a deploy with \`loopscale deploy --project ${projeto}\` from your terminal, or push to a connected Git branch to auto-deploy. Not connected yet? Open the Repository tab to link a repo.`,
    action: {
      label: 'View deploy instructions',
      onClick: () => {
        safeNavigator.goTo(`/projects/${encodeURIComponent(projeto)}/connect`);
      },
    },
  };
}
