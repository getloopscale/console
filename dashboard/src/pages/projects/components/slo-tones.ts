export type Tone = 'success' | 'warning' | 'destructive' | 'muted';

/**
 * Os limiares de SLO do produto, declarados UMA vez (B-194).
 *
 * ## O defeito
 *
 * `uptime 99.9/99.0`, `p95 500/1000 ms` e `error rate 1/5 %` existiam byte a byte em
 * `kpi-strip-status.tsx` e `signal-grid.tsx` — dois componentes que renderizam a MESMA leitura na
 * mesma tela. E `signal-grid.tsx` afirmava, num comentário, ser "color-by-state segundo os
 * limiares canônicos", sendo a segunda implementação deles.
 *
 * Números duplicados não divergem no dia em que são copiados; divergem no dia em que alguém muda
 * um. Um SLO que vale 99.9 num cartão e 99.5 no painel ao lado não é uma inconsistência visual —
 * é a mesma pergunta recebendo duas respostas na mesma tela, e quem lê não tem como saber qual.
 *
 * ## Por que uma tabela e não três funções soltas
 *
 * As três compartilham a forma — valor inválido vira `muted`, dois limiares dividem três faixas —
 * e diferem só na DIREÇÃO (mais é melhor para uptime, pior para latência e erro). A tabela torna a
 * direção explícita em vez de escondida na ordem dos `if`, que é onde ela estava.
 */
interface FaixaSLO {
  /** `higher` = mais é melhor (uptime). `lower` = menos é melhor (latência, erro). */
  readonly direcao: 'higher' | 'lower';
  /** A partir daqui (inclusive) ainda está bom. */
  readonly bom: number;
  /** A partir daqui (inclusive) está no aceitável; fora disso, ruim. */
  readonly aceitavel: number;
}

export const SLO: Record<'uptime' | 'p95LatencyMs' | 'errorRatePct', FaixaSLO> = {
  uptime: { direcao: 'higher', bom: 99.9, aceitavel: 99.0 },
  p95LatencyMs: { direcao: 'lower', bom: 500, aceitavel: 1000 },
  errorRatePct: { direcao: 'lower', bom: 1, aceitavel: 5 },
};

/**
 * O tom de um valor contra o seu SLO.
 *
 * Um valor ausente ou não-finito é `muted` e NÃO `destructive`: não ter medido não é o mesmo que
 * ter medido mal, e pintar de vermelho o que não se sabe é a afirmação que esta varredura inteira
 * está removendo do produto.
 */
export function sloTone(valor: number | null | undefined, faixa: FaixaSLO): Tone {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return 'muted';
  if (faixa.direcao === 'higher') {
    if (valor >= faixa.bom) return 'success';
    return valor >= faixa.aceitavel ? 'warning' : 'destructive';
  }
  if (valor >= faixa.aceitavel) return 'destructive';
  return valor >= faixa.bom ? 'warning' : 'success';
}
