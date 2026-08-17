import { useEffect, useRef, useState } from 'react';
import { cloudFetch } from '@/lib/http/api';
import type { BillingResponse } from '@/lib/api/types';

/**
 * useBillingActivation — a espera pelo plano ativar depois do checkout.
 *
 * ## B-047
 *
 * `settings/billing.tsx` abria um `setInterval` que consultava `/v1/billing` até
 * a assinatura ou o plano mudarem, com teto de 15 tentativas. Estado de servidor
 * guardado à mão, dentro de uma página, sem teste no caminho de desistência.
 *
 * ## Por que não `useQuery` com `refetchInterval`
 *
 * O DoD sugeria, e não serve sem torcer a semântica. A condição de parada não é
 * "chegou dado" — é "o dado MUDOU em relação a um baseline capturado antes do
 * checkout". E há um teto de tentativas com desfecho próprio. Os dois são estado
 * da ESPERA, não do recurso: um `useQuery` guardaria o billing, e ninguém
 * guardaria a espera.
 *
 * ## O defeito corrigido
 *
 * A versão anterior fazia `catch { /* continue polling *\/ }` — engolia tudo.
 * Uma falha PERSISTENTE (500, 402, rede fora) ficava indistinguível de "ainda
 * não ativou": a pessoa esperava 30 segundos e recebia "timeout", que a manda
 * tentar de novo quando o problema é do servidor.
 *
 * Continuar depois de uma falha TRANSITÓRIA é correto e foi preservado. O que
 * mudou é que falhas consecutivas param a espera e reportam `error`. "Não
 * consegui perguntar" e "perguntei e ainda não" são fatos diferentes, e a tela
 * precisa dos dois para dizer a coisa certa.
 */

/** Intervalo entre consultas. Mantido do comportamento anterior. */
export const ACTIVATION_POLL_MS = 2_000;

/** Teto de tentativas — 15 × 2s = 30s. Mantido do comportamento anterior. */
export const ACTIVATION_MAX_ATTEMPTS = 15;

/**
 * Quantas falhas SEGUIDAS bastam para desistir.
 *
 * 3 é escolha: cobre uma oscilação de rede e um deploy do backend sem cobrir uma
 * indisponibilidade real. Baixo demais transformaria um soluço em erro; alto
 * demais devolve o defeito que este hook corrige, só que mais tarde.
 */
const CONSECUTIVE_FAILURES_BEFORE_GIVING_UP = 3;

export type ActivationOutcome = 'success' | 'timeout' | 'error';

export interface BillingActivationResult {
  activating: boolean;
  outcome: ActivationOutcome | null;
  billing: BillingResponse | null;
}

export function useBillingActivation(options: {
  enabled: boolean;
  baseline: { subscription_id?: string | null; plan?: string | null } | null | undefined;
}): BillingActivationResult {
  const { enabled, baseline } = options;
  const [outcome, setOutcome] = useState<ActivationOutcome | null>(null);
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [activating, setActivating] = useState(false);

  // O baseline num ref: ele é capturado UMA vez, antes do checkout. Deixá-lo nas
  // dependências do efeito reiniciaria a espera a cada render do pai e a
  // contagem de tentativas nunca chegaria ao teto.
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  useEffect(() => {
    if (!enabled) return;

    let tentativas = 0;
    let falhasSeguidas = 0;
    let cancelado = false;
    setActivating(true);
    setOutcome(null);

    const idAntigo = baselineRef.current?.subscription_id ?? '';
    const planoAntigo = baselineRef.current?.plan ?? '';

    const encerrar = (r: ActivationOutcome) => {
      if (cancelado) return;
      clearInterval(id);
      setActivating(false);
      setOutcome(r);
    };

    const id = setInterval(() => {
      void (async () => {
        if (cancelado) return;
        tentativas += 1;
        try {
          const atual = await cloudFetch<BillingResponse>('/v1/billing');
          if (cancelado) return;
          falhasSeguidas = 0;

          const newId = atual?.subscription_id ?? '';
          const assinaturaMudou = newId !== '' && newId !== idAntigo;
          // Os DOIS sinais contam: um upgrade dentro da mesma assinatura muda o
          // plano e não o id, e exigir os dois deixaria a pessoa esperando os 30
          // segundos inteiros por algo que já aconteceu.
          const planoMudou = Boolean(atual?.plan) && atual?.plan !== planoAntigo;

          if (atual && (assinaturaMudou || planoMudou)) {
            setBilling(atual);
            encerrar('success');
            return;
          }
        } catch {
          if (cancelado) return;
          falhasSeguidas += 1;
          if (falhasSeguidas >= CONSECUTIVE_FAILURES_BEFORE_GIVING_UP) {
            encerrar('error');
            return;
          }
          // Falha isolada: segue esperando. Era o comportamento anterior, e está
          // certo — o que faltava era o ramo acima.
        }

        if (tentativas >= ACTIVATION_MAX_ATTEMPTS) encerrar('timeout');
      })();
    }, ACTIVATION_POLL_MS);

    return () => {
      // Sem isto, o intervalo sobrevive ao desmonte e consulta o servidor para
      // atualizar um componente que não existe mais.
      cancelado = true;
      clearInterval(id);
    };
  }, [enabled]);

  return { activating, outcome, billing };
}
