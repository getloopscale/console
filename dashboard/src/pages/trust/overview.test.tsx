import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));

const mockTrust = vi.fn();
vi.mock('@/hooks/trust/trust-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/trust/trust-api')>();
  return { ...actual, fetchTrust: (...a: unknown[]) => mockTrust(...a) };
});

import { TrustOverviewPage } from './overview';

/**
 * Esta tela emite um JULGAMENTO numa frase ("tantas políticas não estão sendo bloqueadas"),
 * e é isso que precisa de proteção: um julgamento errado aqui é pior que nenhum, porque o
 * operador age sobre ele.
 *
 * São TRÊS estados que produzem telas parecidas e significam coisas opostas:
 *
 *   1. leu e não há violação        → pode afirmar ausência
 *   2. NÃO leu as violações         → não pode afirmar nada; o vazio é ignorância
 *   3. leu as violações mas NÃO o catálogo → a lista vale, a coluna "bloqueado" está cega,
 *      e toda política aparece descoberta pelo lado seguro — o operador precisa saber disso,
 *      senão lê "descoberta" como fato medido.
 *
 * O caso 3 é o que mais se perde num refactor, porque a tela continua funcionando.
 */

const VIOLACOES = {
  violations: [
    { id: 'v1', policy: 'credential_leak', severity: 'high', detectedAt: '2026-08-02T12:00:00.000Z' },
  ],
};
const CATALOGO = {
  catalogVersion: 1,
  validators: [
    { source: 'platform', name: 'credential-mask', kind: 'rule', directions: ['input', 'output'] },
  ],
};

/** Responde por CAMINHO — as duas leituras da tela falham de formas diferentes, e é o ponto. */
function responder({ violacoes, catalogo }: { violacoes?: unknown; catalogo?: unknown }) {
  mockTrust.mockImplementation((path: string) => {
    const alvo = path.startsWith('/validators') ? catalogo : violacoes;
    return alvo instanceof Error ? Promise.reject(alvo) : Promise.resolve(alvo);
  });
}

describe('TrustOverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responder({ violacoes: VIOLACOES, catalogo: CATALOGO });
  });

  it('quando a leitura das violações FALHA, não afirma ausência de violação', async () => {
    responder({ violacoes: new Error('trust fora do ar'), catalogo: CATALOGO });
    render(<TrustOverviewPage />);

    expect(await screen.findByText('Could not read the trust layer')).toBeInTheDocument();
    expect(screen.getByText('No reading from the trust layer.')).toBeInTheDocument();
    expect(screen.getByText('No data — the read failed')).toBeInTheDocument();

    // O julgamento de ausência não pode aparecer: a tela não sabe.
    expect(screen.queryByText('No violation recorded.')).not.toBeInTheDocument();
  });

  it('quando só o CATÁLOGO falha, mantém a lista e avisa que a cobertura está cega', async () => {
    responder({ violacoes: VIOLACOES, catalogo: new Error('catálogo fora do ar') });
    render(<TrustOverviewPage />);

    // A falha do catálogo NÃO é a falha da tela — o alerta destrutivo não deve aparecer.
    expect(await screen.findByText('The guardrail catalog did not respond')).toBeInTheDocument();
    expect(screen.queryByText('Could not read the trust layer')).not.toBeInTheDocument();
    expect(screen.queryByText('No data — the read failed')).not.toBeInTheDocument();
  });

  it('quando LEU tudo e não há violação, aí sim afirma a ausência', async () => {
    // O par que impede a correção de virar "nunca afirme nada": sem ele, uma tela que só
    // emitisse avisos passaria nos dois testes acima e não informaria coisa alguma.
    responder({ violacoes: { violations: [] }, catalogo: CATALOGO });
    render(<TrustOverviewPage />);

    expect(await screen.findByText('No violation recorded.')).toBeInTheDocument();
    expect(screen.queryByText('Could not read the trust layer')).not.toBeInTheDocument();
    expect(screen.queryByText('The guardrail catalog did not respond')).not.toBeInTheDocument();
  });
});
