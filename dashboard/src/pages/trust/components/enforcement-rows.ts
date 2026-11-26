import type { EnforcementEvent, EnforcementPayload } from '@/hooks/trust/trust-payloads';

// Re-export: B-052 moveu a DECLARACAO para junto de quem busca (o guard de
// camada nao deixa `hooks/` importar de `pages/`); o caminho continua valendo.
export type { EnforcementEvent, EnforcementPayload };
/**
 * M24 T7.1 — a projeção do log de auditoria do enforcement inline.
 *
 * A regra que este módulo carrega é de segurança, não de formatação: **só o marcador redigido
 * atravessa**. O `loopguardrails` já garante a redação na origem — conteúdo bruto nunca chega àquela
 * tabela — e esta projeção só expõe campos nomeados, nunca a linha inteira do serviço. Assim, se
 * um dia o serviço passar a devolver um campo com trecho bruto, ele não aparece na tela por
 * omissão: teria de ser adicionado aqui, de propósito, por alguém.
 */

type EnforcementDecision = 'block' | 'modify' | 'allow' | 'unknown';



export interface EnforcementRow {
  readonly key: string;
  readonly decision: EnforcementDecision;
  /** Texto da decisão — a distinção não pode depender só de cor. */
  readonly decisionLabel: string;
  readonly direction: string;
  readonly category: string;
  readonly validatorName: string;
  /** O marcador redigido. Nunca conteúdo bruto. */
  readonly redacted: string;
  readonly createdAt: string;
}

const DECISION_LABEL: Record<EnforcementDecision, string> = {
  block: 'Blocked',
  modify: 'Rewritten',
  allow: 'Allowed',
  unknown: 'Unknown',
};

function decisionOf(raw: string | undefined): EnforcementDecision {
  return raw === 'block' || raw === 'modify' || raw === 'allow' ? raw : 'unknown';
}

function text(value: string | undefined): string {
  return typeof value === 'string' && value.trim() !== '' ? value : '—';
}

export function enforcementRows(payload: EnforcementPayload | null | undefined): EnforcementRow[] {
  const events = Array.isArray(payload?.events) ? payload.events : [];

  return events.map((e, index) => {
    const decision = decisionOf(e.decision);
    return {
      key: typeof e.id === 'string' && e.id !== '' ? e.id : `event-${index}`,
      decision,
      decisionLabel: DECISION_LABEL[decision],
      direction: text(e.direction),
      category: text(e.category),
      validatorName: text(e.validatorName),
      redacted: text(e.redacted),
      createdAt: text(e.createdAt),
    };
  });
}

/** Quantos bloqueios há na janela — o número que responde "a proteção está agindo?". */
export function blockedCount(rows: readonly EnforcementRow[]): number {
  return rows.filter((r) => r.decision === 'block').length;
}
