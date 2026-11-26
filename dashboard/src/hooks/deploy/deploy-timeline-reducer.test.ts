// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { aplicarEvento, estadoInicial, faseCorrente, settleWithDeployStatus } from './deploy-timeline-reducer';

const ev = (type: string, data: unknown = {}) => ({ type, data });
const fase = (e: ReturnType<typeof estadoInicial>, nome: string) =>
  e.phases.find((p) => p.phase === nome);

describe('aplicarEvento', () => {
  it('marca a fase que o evento nomeia', () => {
    const e = aplicarEvento(estadoInicial(), ev('deploy_timeline.build.in_progress', { timestamp: 't1' }));
    expect(fase(e, 'build')?.status).toBe('in_progress');
    expect(fase(e, 'build')?.startedAt).toBe('t1');
  });

  it('guarda o fim só nos status terminais', () => {
    const a = aplicarEvento(estadoInicial(), ev('deploy_timeline.build.in_progress', { timestamp: 't1' }));
    expect(fase(a, 'build')?.endedAt).toBeNull();
    const b = aplicarEvento(a, ev('deploy_timeline.build.completed', { timestamp: 't2' }));
    expect(fase(b, 'build')?.endedAt).toBe('t2');
  });

  it('não sobrescreve o início já registrado', () => {
    // O primeiro timestamp é quando a fase começou; um evento posterior fala de outro instante.
    const a = aplicarEvento(estadoInicial(), ev('deploy_timeline.build.in_progress', { timestamp: 't1' }));
    const b = aplicarEvento(a, ev('deploy_timeline.build.completed', { timestamp: 't9' }));
    expect(fase(b, 'build')?.startedAt).toBe('t1');
  });

  it('um evento desconhecido devolve o estado INTACTO, por identidade', () => {
    // Identidade e não igualdade: o consumidor precisa distinguir "nada mudou" sem comparar campos.
    const e = estadoInicial();
    expect(aplicarEvento(e, ev('outra.coisa.qualquer'))).toBe(e);
    expect(aplicarEvento(e, ev('deploy_timeline.fase_que_nao_existe.completed'))).toBe(e);
  });

  it('registra a degradação do agregador', () => {
    const e = aplicarEvento(estadoInicial(), ev('deploy_timeline.aggregator.degraded', { degraded_reason: 'lag' }));
    expect(e.aggregatorDegradedReason).toBe('lag');
  });
});

describe('B-181 — o que um evento estabeleceu não depende de ele continuar no buffer', () => {
  it('uma fase concluída CONTINUA concluída depois de muitos eventos posteriores', () => {
    // O defeito: o estado era re-derivado varrendo um FIFO de 60 eventos. O 61º descartava o
    // primeiro — e se o descartado fosse `build.completed`, a fase de build voltava a `pending`
    // numa tela que já a mostrara concluída. Estado durável não pode ser derivado de uma janela
    // deslizante; ele é acumulado.
    let e = aplicarEvento(estadoInicial(), ev('deploy_timeline.build.completed', { timestamp: 't1' }));
    expect(fase(e, 'build')?.status).toBe('completed');

    // Cem eventos depois — muito além de qualquer teto de buffer.
    for (let i = 0; i < 100; i += 1) {
      e = aplicarEvento(e, ev('deploy_timeline.deploy.in_progress', { timestamp: `t${String(i)}` }));
    }

    expect(fase(e, 'build')?.status).toBe('completed');
    expect(fase(e, 'build')?.endedAt).toBe('t1');
  });
});

describe('B-174 — chegada fora de ordem', () => {
  it('uma fase anterior a uma concluída herda completed', () => {
    const e = aplicarEvento(estadoInicial(), ev('deploy_timeline.deploy.completed', { timestamp: 't1' }));
    expect(fase(e, 'build')?.status).toBe('completed');
  });

  it('mas uma fase anterior que FALHOU não é apagada pela herança', () => {
    // A herança existe para preencher lacunas de ordem, não para reescrever um desfecho conhecido.
    let e = aplicarEvento(estadoInicial(), ev('deploy_timeline.build.failed', { timestamp: 't1' }));
    e = aplicarEvento(e, ev('deploy_timeline.deploy.completed', { timestamp: 't2' }));
    expect(fase(e, 'build')?.status).toBe('failed');
  });
});

describe('faseCorrente', () => {
  it('prefere a fase viva', () => {
    let e = aplicarEvento(estadoInicial(), ev('deploy_timeline.build.completed', {}));
    e = aplicarEvento(e, ev('deploy_timeline.sign.in_progress', {}));
    expect(faseCorrente(e.phases).phase).toBe('sign');
  });

  it('sem fase viva, aponta a última que saiu de pending', () => {
    const e = aplicarEvento(estadoInicial(), ev('deploy_timeline.build.failed', {}));
    expect(faseCorrente(e.phases).phase).toBe('build');
  });

  it('no estado inicial, aponta a primeira', () => {
    expect(faseCorrente(estadoInicial().phases).phase).toBe('build');
  });
});

describe('settleWithDeployStatus', () => {
  // The engine's timeline can stop short: the process that writes it restarted mid-deploy.
  const stalled = () =>
    [
      ev('deploy_timeline.build.completed', { timestamp: 't1' }),
      ev('deploy_timeline.sign.completed', { timestamp: 't2' }),
      ev('deploy_timeline.release.completed', { timestamp: 't3' }),
      ev('deploy_timeline.deploy.completed', { timestamp: 't4' }),
      ev('deploy_timeline.live.in_progress', { timestamp: 't5' }),
    ].reduce(aplicarEvento, estadoInicial()).phases;

  it.each(['succeeded', 'superseded', 'rolled_back', 'archived'])(
    'completes a stalled live phase when the build record says the deploy ended as %s',
    (deployStatus) => {
      const live = settleWithDeployStatus(stalled(), deployStatus).find((p) => p.phase === 'live');
      expect(live?.status).toBe('completed');
      expect(live?.endedAt).toBe('t5');
    },
  );

  it.each([undefined, 'in_progress', 'failed', 'rollback_failed', 'cancelled'])(
    'leaves the phases alone when the deploy status is %s',
    (deployStatus) => {
      const phases = stalled();
      expect(settleWithDeployStatus(phases, deployStatus)).toBe(phases);
    },
  );

  it('keeps a failed phase failed', () => {
    const phases = aplicarEvento(estadoInicial(), ev('deploy_timeline.deploy.failed', { timestamp: 't1' })).phases;
    expect(settleWithDeployStatus(phases, 'superseded')).toBe(phases);
  });
});
