// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { REGRAS, lerMedidas, type Medidas } from './readiness-rules';

const medidas = (over: Partial<Medidas> = {}): Medidas => ({
  projetoIndisponivel: false,
  statusIndisponivel: false,
  deploysIndisponiveis: false,
  ultimoDeploy: null,
  replicasDesejadas: 0,
  replicasProntas: 0,
  alertasAtivos: 0,
  pct5xx1h: 0,
  totalBuilds: 0,
  ...over,
});

describe('logs_healthy — as três faixas de 5xx', () => {
  // Estas faixas nunca tiveram teste próprio: exercitá-las exigia montar o hook e mockar três
  // hooks compostos, então na prática só a faixa `pass` (o default 0) era coberta. É o ganho
  // concreto de tirar as regras de dentro do useMemo.
  it.each([
    [0, 'pass'],
    [0.009, 'pass'],
    [0.01, 'warn'],
    [0.049, 'warn'],
    [0.05, 'fail'],
    [1, 'fail'],
  ])('5xx de %s%% => %s', (pct, esperado) => {
    expect(REGRAS.logs_healthy(medidas({ pct5xx1h: pct as number }))).toBe(esperado);
  });

  it('status indisponível vence a faixa — não culpa o projeto por uma falha nossa', () => {
    expect(REGRAS.logs_healthy(medidas({ statusIndisponivel: true, pct5xx1h: 1 }))).toBe('unknown');
  });
});

describe('as réplicas — desejadas e prontas medem coisas diferentes', () => {
  it('desejar duas configura HPA; ter uma pronta ainda não são duas servindo', () => {
    const m = medidas({ replicasDesejadas: 2, replicasProntas: 1 });
    expect(REGRAS.hpa_configured(m)).toBe('pass');
    expect(REGRAS.two_plus_replicas(m)).toBe('fail');
  });

  it('a fronteira de two_plus_replicas é 2, não 3', () => {
    expect(REGRAS.two_plus_replicas(medidas({ replicasProntas: 2 }))).toBe('pass');
  });

  it('uma réplica desejada não é postura de escala', () => {
    expect(REGRAS.hpa_configured(medidas({ replicasDesejadas: 1 }))).toBe('fail');
  });
});

describe('alerts_configured — zero é ambíguo, e por isso não é fail', () => {
  it('alertas disparando provam que existem alertas', () => {
    expect(REGRAS.alerts_configured(medidas({ alertasAtivos: 1 }))).toBe('warn');
  });

  it('zero alertas ativos permanece unknown', () => {
    // Nenhum alerta configurado e tudo saudável produzem o mesmo zero. `fail` acusaria metade dos
    // projetos saudáveis de estarem desconfigurados.
    expect(REGRAS.alerts_configured(medidas({ alertasAtivos: 0 }))).toBe('unknown');
  });
});

describe('o que não dá para medir fica unknown, nunca fail', () => {
  it.each(['secrets_rotated', 'custom_domain'] as const)('%s', (nome) => {
    expect(REGRAS[nome](medidas())).toBe('unknown');
  });

  it('cache_hit_rate sem nenhum build é unknown, e não pass', () => {
    expect(REGRAS.cache_hit_rate(medidas({ totalBuilds: 0 }))).toBe('unknown');
    expect(REGRAS.cache_hit_rate(medidas({ totalBuilds: 1 }))).toBe('pass');
  });

  it('auto_deploy sem a linha do projeto é unknown, e não fail', () => {
    // A sonda cross-tenant devolve 401 e o projeto não resolve. Marcar `fail` aí diria que o
    // auto-deploy do projeto está quebrado quando o que houve foi uma recusa de permissão.
    expect(REGRAS.auto_deploy(medidas({ projetoIndisponivel: true }))).toBe('unknown');
    expect(REGRAS.auto_deploy(medidas({ ultimoDeploy: null }))).toBe('fail');
    expect(REGRAS.auto_deploy(medidas({ ultimoDeploy: '2026-08-11' }))).toBe('pass');
  });
});

describe('lerMedidas', () => {
  it('um corpo de status ausente é indisponibilidade, mesmo sem erro', () => {
    // As duas causas — o hook falhou, ou respondeu sem corpo — levam à mesma leitura: não medimos.
    expect(lerMedidas({ projeto: {}, statusErro: null, status: null, deploysErro: null, builds: [] })
      .statusIndisponivel).toBe(true);
    expect(lerMedidas({ projeto: {}, statusErro: new Error('x'), status: { replicas_ready: 3 }, deploysErro: null, builds: [] })
      .statusIndisponivel).toBe(true);
  });

  it('campos ausentes viram zero, e o zero é uma medida — não um desconhecido', () => {
    const m = lerMedidas({ projeto: {}, statusErro: null, status: {}, deploysErro: null, builds: undefined });
    expect(m.replicasProntas).toBe(0);
    expect(m.totalBuilds).toBe(0);
    expect(m.statusIndisponivel).toBe(false);
  });
});
