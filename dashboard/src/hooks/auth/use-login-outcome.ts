import { useEffect } from 'react';
import { takePendingAttempt } from '@/hooks/auth/auth-attempt';
import { classifyKratosErrorReason } from '@/hooks/auth/kratos-error-detail';
import { reportEvent, viewportBucket } from '@/lib/telemetry/rum';
import type {
  ActivationEvent,
  AuthMethod,
  AuthFailureReason,
  AuthTelemetryPayload,
} from '@/lib/telemetry/rum';

/**
 * emitAuthTelemetry — o emissor do funil de autenticacao.
 *
 * INVARIANTE SEM PII, coberta por `test_login_payload_pii_free`: o payload NUNCA
 * carrega email, senha, sessionID, userID, tenantID ou referrer. Ver o bloco de
 * `AuthTelemetryPayload` em lib/telemetry/rum.ts.
 *
 * Mora aqui, e nao dentro do componente de login, porque e o irmao do emissor de
 * desfecho abaixo: os dois lados do mesmo funil, com a mesma forma de payload. A
 * mudanca tambem tirou login.tsx do orcamento de 500 linhas — mas o motivo de
 * ficarem juntos e coesao, nao contagem.
 */
export function emitAuthTelemetry(
  event: Extract<ActivationEvent, `auth.method.${string}`>,
  ctx: { method: AuthMethod; correlation_id: string; started_at: number },
  extras: { reason?: AuthFailureReason } = {},
): void {
  const payload: AuthTelemetryPayload = {
    v: 1,
    method: ctx.method,
    correlation_id: ctx.correlation_id,
    latency_ms:
      event === 'auth.method.attempt' ? undefined : Math.max(0, Date.now() - ctx.started_at),
    reason: extras.reason,
    viewport_bucket: viewportBucket(),
    timestamp: Date.now(),
  };
  reportEvent(event, payload as unknown as Record<string, unknown>);
}

/** A forma minima de um flow do Kratos que este hook precisa ler. */
interface FlowComMensagens {
  ui?: {
    messages?: { type: string; text: string | null }[];
    nodes?: { messages?: { type: string; text: string | null }[] }[];
  };
}

/**
 * B-096 — o desfecho de FALHA, do outro lado da navegacao.
 *
 * O par de `useRequireAuth`: la o Kratos aceitou e a pessoa entrou; aqui ele
 * recusou e devolveu para `/login?flow=X` com os erros nos `ui.messages`. Sem
 * este efeito, uma senha errada era indistinguivel de alguem que abriu a tela
 * e desistiu — as duas apareciam como um `attempt` sem desfecho.
 *
 * `classifyKratosErrorReason` existia exportado e sem consumidor desde
 * 2026-06-01, com um comentario dizendo que servia "para o caminho de
 * classificacao pos-mount quando ele chegar". Chegou.
 *
 * `takePendingAttempt` e de leitura unica, entao recarregar a pagina de erro
 * nao emite uma segunda falha para a mesma tentativa.
 */
export function useLoginFailureOutcome(flow: FlowComMensagens | null | undefined): void {
  useEffect(() => {
  if (!flow) return;
  const erros = [
    ...(flow.ui?.messages?.filter((m) => m.type === 'error') ?? []),
    ...(flow.ui?.nodes
      ?.flatMap((n) => n.messages ?? [])
      .filter((m) => m.type === 'error') ?? []),
  ];
  if (erros.length === 0) return;
  const tentativa = takePendingAttempt();
  if (!tentativa) return;
  reportEvent('auth.method.failure', {
    v: 1,
    method: tentativa.method,
    correlation_id: tentativa.correlation_id,
    latency_ms: Math.max(0, Date.now() - tentativa.started_at),
    reason: classifyKratosErrorReason(erros),
    viewport_bucket: viewportBucket(),
    timestamp: Date.now(),
  });
  }, [flow]);
}