import { useMemo } from 'react';
import { useToast } from '@getloopscale/ui';
import { useFirstDeployTrigger } from '@/hooks/projects/use-first-deploy-trigger';

/**
 * B-030 — a celebração do primeiro deploy, finalmente ligada.
 *
 * `useFirstDeployTrigger` existe desde 2026-06 e nunca teve consumidor: 52 dias
 * alcançado apenas pelo próprio teste. Não era esboço — respeita
 * `prefers-reduced-motion`, trava por `localStorage` para não repetir entre abas,
 * filtra builds históricos por `mountedAt`, e emite telemetria. Faltava o lugar.
 *
 * ## Por que um componente sem marcação
 *
 * O hook precisa de um `toast`, e `useToast` só pode ser chamado dentro da
 * árvore. Um componente vazio é o menor recipiente possível: `project-detail.tsx`
 * o monta, e nada mais muda ali.
 *
 * ## Por que em project-detail
 *
 * Ela já chama `useDeployments(name)` (linha 61) e já tem a URL viva em
 * `status.url`. O hook consome os dois — então ligar aqui custa **zero requests
 * a mais**. Numa página que não buscasse deployments, a celebração pagaria uma
 * chamada de rede por carregamento para, quase sempre, não celebrar nada.
 *
 * ## O adaptador de toast
 *
 * O hook pede `{ show(message) }`; o kit expõe `toast({ title, description })`.
 * A tradução mora aqui e não no hook, porque o hook não deve saber qual biblioteca
 * de UI o app usa — é a mesma direção de dependência que `rules/architecture.md`
 * pede para o resto.
 */
export function FirstDeployCelebration({
  projectName,
  liveUrl,
}: {
  projectName: string | undefined;
  liveUrl?: string;
}) {
  const { toast } = useToast();

  // `useMemo` porque o hook tem `toast` nas dependências do efeito: um objeto
  // novo a cada render reexecutaria o efeito a cada render, e a trava de
  // localStorage seria a única coisa impedindo confetti em loop.
  const ponte = useMemo(
    () => ({
      show: (message: string) =>
        toast({ title: 'First deploy', description: message, variant: 'success' }),
    }),
    [toast],
  );

  useFirstDeployTrigger({ projectName, toast: ponte, liveUrl });
  return null;
}
