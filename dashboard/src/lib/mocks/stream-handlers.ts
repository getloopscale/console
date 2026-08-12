/**
 * Os streams SSE do modo mock — todos eles, num lugar só.
 *
 * ## Por que saíram de `handlers.ts`
 *
 * Não por gosto de arquivo pequeno. `handlers.ts` tinha 812 linhas contra um teto anotado de 774,
 * e a catraca de LoC (B-009/B-033) reprova um arquivo isento que CRESCE — a isenção existe para
 * dívida registrada, não para dívida livre. A mensagem da própria catraca diz o caminho: decompor
 * e baixar o número.
 *
 * A fronteira não é arbitrária. Um handler de rota responde UMA vez; um emissor de stream tem
 * ciclo de vida — abre, emite ao longo do tempo, e devolve o seu próprio dispose. São duas
 * responsabilidades com formas diferentes que estavam no mesmo arquivo por proximidade histórica.
 *
 * ## O guarda que acompanha
 *
 * `sse-registration.test.ts` compara os caminhos que os hooks CONSOMEM com os registrados aqui, e
 * reprova quando um consumidor nasce sem resposta em modo mock (B-178) — que foi como
 * `/projects/{name}/builds/stream` e `/projects/{name}/signals/stream` passaram despercebidos.
 */
import { registerSSE } from './sse';
import { buildLogLines, runtimeLogLines } from './fixtures';

export function registerStreamHandlers(): void {
  registerSSE('/api/v1/builds/{id}/logs/stream', (es) => {
    let i = 0;
    const interval = setInterval(() => {
      if (i >= buildLogLines.length) {
        clearInterval(interval);
        return;
      }
      es.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify(buildLogLines[i++]) }),
      );
    }, 600);
    return () => clearInterval(interval);
  });

  registerSSE('/api/v1/projects/{name}/logs/stream', (es) => {
    let i = 0;
    const interval = setInterval(() => {
      const line = runtimeLogLines[i % runtimeLogLines.length];
      i++;
      es.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ ...line, ts: new Date().toISOString() }),
        }),
      );
    }, 1000);
    return () => clearInterval(interval);
  });

  registerSSE('/api/v1/builds/{id}/stream', (es) => {
    // Canonical step-level seed mirroring the build pipeline phase_group
    // taxonomy. Used by the step-expansion E2E tests + visual validation.
    const steps: Array<{
      step_name: string;
      phase_group: 'clone' | 'install' | 'build' | 'sign' | 'deliver' | 'other';
      duration_seconds: number;
    }> = [
      { step_name: 'clone-repo', phase_group: 'clone', duration_seconds: 9 },
      { step_name: 'install-deps', phase_group: 'install', duration_seconds: 47 },
      { step_name: 'build-image', phase_group: 'build', duration_seconds: 82 },
      { step_name: 'cosign-sign', phase_group: 'sign', duration_seconds: 21 },
      { step_name: 'syft-sbom', phase_group: 'sign', duration_seconds: 11 },
      { step_name: 'generate-manifests', phase_group: 'deliver', duration_seconds: 2 },
      { step_name: 'gitops-push', phase_group: 'deliver', duration_seconds: 2 },
    ];
    let i = 0;
    let lastId = 0;
    const baseTime = Date.now();
    const interval = setInterval(() => {
      if (i >= steps.length) {
        clearInterval(interval);
        return;
      }
      const step = steps[i++];
      // Emit started + succeeded back-to-back so the test sees finished steps.
      const started_at = new Date(baseTime + i * 1000).toISOString();
      const ended_at = new Date(baseTime + i * 1000 + step.duration_seconds * 1000).toISOString();
      lastId++;
      es.dispatchEvent(
        new MessageEvent('build.step.started', {
          data: JSON.stringify({ step_name: step.step_name, started_at, phase_group: step.phase_group }),
          lastEventId: String(lastId),
        }),
      );
      lastId++;
      es.dispatchEvent(
        new MessageEvent('build.step.succeeded', {
          data: JSON.stringify({
            step_name: step.step_name,
            started_at,
            ended_at,
            duration_seconds: step.duration_seconds,
            phase_group: step.phase_group,
          }),
          lastEventId: String(lastId),
        }),
      );
    }, 200);
    return () => clearInterval(interval);
  });

  // B-178 — estes dois eram CONSUMIDOS e nunca registrados. Em modo mock o ramo nao-registrado
  // dispara um erro sem motivo, que vira `network-error`: a lista de deploys e a faixa de sinais
  // ficavam sem evento algum, no exato ambiente onde as telas sao validadas. O guarda que impede
  // o terceiro caminho de nascer assim e `lib/mocks/sse-registration.test.ts`.
  registerSSE('/api/v1/projects/{name}/builds/stream', (es) => {
    const seq = ['build.started', 'build.succeeded'];
    let i = 0;
    const interval = setInterval(() => {
      if (i >= seq.length) { clearInterval(interval); return; }
      const tipo = seq[i++];
      es.dispatchEvent(
        new MessageEvent(tipo, {
          data: JSON.stringify({ build_id: 'bld-mock-1', status: tipo.split('.')[1] }),
          lastEventId: String(i),
        }),
      );
    }, 800);
    return () => clearInterval(interval);
  });

  registerSSE('/api/v1/projects/{name}/signals/stream', (es) => {
    const seq = [
      { signal: 'logs_healthy', state: 'pass' },
      { signal: 'traffic', state: 'warn' },
    ];
    let i = 0;
    const interval = setInterval(() => {
      if (i >= seq.length) { clearInterval(interval); return; }
      es.dispatchEvent(
        new MessageEvent('signal.changed', {
          data: JSON.stringify(seq[i++]),
          lastEventId: String(i),
        }),
      );
    }, 1000);
    return () => clearInterval(interval);
  });

  // Plan deploy-timeline-canonical-5-phases — canonical 5-phase mock
  // mirrors the server's emit shape (deploy_timeline.<phase>.<status>).
  // Used by browser-runtime E2E + visual-validation mode.
  registerSSE('/api/v1/deploys/{id}/timeline', (es) => {
    const seq: Array<{ phase: string; status: string; substate: string; source: string }> = [
      { phase: 'build', status: 'in_progress', substate: 'clone · install · build image', source: 'release_db' },
      { phase: 'build', status: 'completed', substate: 'clone · install · build image', source: 'release_db' },
      { phase: 'sign', status: 'in_progress', substate: 'image signing · supply-chain manifest', source: 'release_db' },
      { phase: 'sign', status: 'completed', substate: 'image signing · supply-chain manifest', source: 'release_db' },
      { phase: 'release', status: 'in_progress', substate: 'manifest · the deployment system', source: 'release_db' },
      { phase: 'release', status: 'completed', substate: 'manifest · the deployment system', source: 'release_db' },
      { phase: 'deploy', status: 'in_progress', substate: 'the deployment system · pods up', source: 'argocd_app' },
      { phase: 'deploy', status: 'completed', substate: 'the deployment system · pods up', source: 'argocd_app' },
      { phase: 'live', status: 'in_progress', substate: 'live URL responds 200', source: 'status_url_probe' },
      { phase: 'live', status: 'completed', substate: 'live URL responds 200', source: 'status_url_probe' },
    ];
    let i = 0;
    let lastId = 0;
    const interval = setInterval(() => {
      if (i >= seq.length) {
        clearInterval(interval);
        return;
      }
      const item = seq[i++];
      lastId++;
      const payload = {
        deploy_id: 'mock-deploy',
        phase: item.phase,
        status: item.status,
        source: item.source,
        substate_message: item.substate,
        timestamp: new Date().toISOString(),
      };
      const ev = new MessageEvent(`deploy_timeline.${item.phase}.${item.status}`, {
        data: JSON.stringify(payload),
        lastEventId: String(lastId),
      });
      es.dispatchEvent(ev);
    }, 250);
    return () => clearInterval(interval);
  });
}

// ============================================================================
// Secrets
// ============================================================================
