import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/http/api')>('@/lib/http/api');
  return { ...actual, cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) };
});

import {
  useBillingActivation,
  ACTIVATION_POLL_MS,
  ACTIVATION_MAX_ATTEMPTS,
} from './use-billing-activation';

/**
 * B-047 — a espera pela ativação do plano sai da página e ganha rede de teste.
 *
 * ## O que existia
 *
 * `settings/billing.tsx:91` abria um `setInterval` que consultava `/v1/billing` a
 * cada 2s até que a assinatura ou o plano mudassem em relação a um baseline, com
 * teto de 15 tentativas. Estado de servidor guardado à mão, ao lado de hooks que
 * fazem isso declarativamente.
 *
 * ## O defeito que a auditoria não nomeou
 *
 * ```js
 * } catch {
 *   /* continue polling *\/
 * }
 * ```
 *
 * O erro era engolido inteiro. Uma falha PERSISTENTE da API — 500, 402, rede
 * fora — ficava indistinguível de "ainda não ativou": a pessoa esperava 30
 * segundos e recebia "timeout", que a manda tentar de novo em vez de dizer o que
 * houve. Continuar a consultar depois de uma falha TRANSITÓRIA é correto; tratar
 * uma falha permanente como paciência é o que este hook separa.
 *
 * ## Por que não `useQuery` com `refetchInterval`
 *
 * O DoD sugeria. Não serve aqui sem torcer a semântica: a condição de parada não
 * é "chegou dado", é "o dado MUDOU em relação a um baseline capturado antes do
 * checkout" — e há um teto de tentativas com desfecho próprio. Ambos são estado
 * da ESPERA, não do recurso. Um `useQuery` guardaria o billing; ninguém guardaria
 * a espera.
 */

const BASE = { subscription_id: 'sub_antigo', plan: 'free' };

describe('useBillingActivation (B-047)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCloudFetch.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('para e reporta sucesso quando a ASSINATURA muda', async () => {
    mockCloudFetch.mockResolvedValue({ subscription_id: 'sub_novo', plan: 'free' });
    const { result } = renderHook(() => useBillingActivation({ enabled: true, baseline: BASE }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVATION_POLL_MS);
    });
    expect(result.current.outcome).toBe('success');
    expect(result.current.billing?.subscription_id).toBe('sub_novo');
  });

  it('para e reporta sucesso quando só o PLANO muda', async () => {
    mockCloudFetch.mockResolvedValue({ subscription_id: 'sub_antigo', plan: 'pro' });
    const { result } = renderHook(() => useBillingActivation({ enabled: true, baseline: BASE }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVATION_POLL_MS);
    });
    // Os dois sinais contam: um upgrade dentro da mesma assinatura muda o plano
    // e não o id. Exigir os dois deixaria a pessoa esperando os 30s inteiros.
    expect(result.current.outcome).toBe('success');
  });

  it('NÃO para enquanto nada mudou', async () => {
    mockCloudFetch.mockResolvedValue({ ...BASE });
    const { result } = renderHook(() => useBillingActivation({ enabled: true, baseline: BASE }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVATION_POLL_MS * 3);
    });
    expect(result.current.outcome).toBeNull();
    expect(result.current.activating).toBe(true);
  });

  it('desiste depois do teto de tentativas', async () => {
    mockCloudFetch.mockResolvedValue({ ...BASE });
    const { result } = renderHook(() => useBillingActivation({ enabled: true, baseline: BASE }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVATION_POLL_MS * ACTIVATION_MAX_ATTEMPTS);
    });
    // Caminho que a página tinha e nenhum teste cobria — foi por isso que o
    // defeito do catch mudo sobreviveu.
    expect(result.current.outcome).toBe('timeout');
    expect(result.current.activating).toBe(false);
  });

  it('uma falha TRANSITÓRIA não interrompe a espera', async () => {
    mockCloudFetch
      .mockRejectedValueOnce(new Error('rede oscilou'))
      .mockResolvedValue({ subscription_id: 'sub_novo', plan: 'free' });
    const { result } = renderHook(() => useBillingActivation({ enabled: true, baseline: BASE }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVATION_POLL_MS * 2);
    });
    // Continuar depois de um erro isolado é o comportamento certo, e é por isso
    // que o `catch` existia. O que faltava era distinguir isso do caso abaixo.
    expect(result.current.outcome).toBe('success');
  });

  it('falhas CONSECUTIVAS param a espera e reportam erro, não timeout', async () => {
    mockCloudFetch.mockRejectedValue(new Error('500 upstream'));
    const { result } = renderHook(() => useBillingActivation({ enabled: true, baseline: BASE }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVATION_POLL_MS * 4);
    });
    // ESTE é o defeito corrigido. Antes, um 500 persistente virava "timeout"
    // depois de 30 segundos: a mensagem manda tentar de novo, quando o problema
    // é do servidor e tentar de novo não vai resolver. "Não consegui perguntar"
    // e "perguntei e ainda não" são fatos diferentes.
    expect(result.current.outcome).toBe('error');
    expect(result.current.activating).toBe(false);
  });

  it('desabilitado não consulta nada', async () => {
    renderHook(() => useBillingActivation({ enabled: false, baseline: BASE }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVATION_POLL_MS * 3);
    });
    expect(mockCloudFetch).not.toHaveBeenCalled();
  });

  it('desmontar interrompe a espera', async () => {
    mockCloudFetch.mockResolvedValue({ ...BASE });
    const { unmount } = renderHook(() => useBillingActivation({ enabled: true, baseline: BASE }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVATION_POLL_MS);
    });
    const antes = mockCloudFetch.mock.calls.length;
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVATION_POLL_MS * 3);
    });
    // Um intervalo que sobrevive ao desmonte consulta o servidor para atualizar
    // um componente que não existe mais.
    expect(mockCloudFetch.mock.calls.length).toBe(antes);
  });
});
