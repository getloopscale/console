import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));

const mockEvents = vi.fn();
vi.mock('@/hooks/trust/trust-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/trust/trust-api')>();
  return { ...actual, fetchEnforcementEvents: (...a: unknown[]) => mockEvents(...a) };
});

import { TrustEnforcementPage } from './enforcement';

/**
 * O que esta tela precisa provar não é que renderiza — é que **uma tabela vazia por FALHA
 * nunca se parece com uma tabela vazia por AUSÊNCIA**.
 *
 * As duas produzem exatamente o mesmo vazio na tela. Se o ramo de erro colapsar num refactor,
 * a página passa a afirmar "nenhuma mensagem foi bloqueada" quando na verdade não sabe — e
 * essa é a pior mentira que um painel de segurança pode contar, porque parece uma boa notícia.
 *
 * A lógica de linhas (`enforcement-rows.ts`) já tem teste próprio; o que falta cobrir, e é o
 * que se cobre aqui, é a decisão da TELA entre esses dois vazios.
 */

const PAYLOAD = {
  events: [
    {
      id: 'ev-1',
      decision: 'block',
      validatorName: 'credential-mask',
      category: 'credential_leak',
      redacted: 'sk…j0',
      createdAt: '2026-08-02T12:00:00.000Z',
    },
    {
      id: 'ev-2',
      decision: 'allow',
      validatorName: 'termos-internos',
      category: 'ban_list',
      redacted: '—',
      createdAt: '2026-08-02T12:05:00.000Z',
    },
  ],
};

describe('TrustEnforcementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEvents.mockResolvedValue(PAYLOAD);
  });

  it('mostra o que foi barrado, com a contagem de bloqueios', async () => {
    render(<TrustEnforcementPage />);

    expect(await screen.findByText('credential-mask')).toBeInTheDocument();
    // A contagem é o resumo que o operador lê antes da tabela; ela distingue "houve registro"
    // de "houve BLOQUEIO", que não são a mesma coisa (um `allow` também é registrado).
    expect(screen.getByText(/1 block\(s\) among 2 record\(s\)/)).toBeInTheDocument();
  });

  it('quando a leitura FALHA, não afirma que nada foi bloqueado', async () => {
    mockEvents.mockRejectedValue(new Error('upstream fora do ar'));
    render(<TrustEnforcementPage />);

    // O aviso é obrigatório: sem ele, o vazio abaixo seria lido como boa notícia.
    expect(await screen.findByText('Could not load the audit trail')).toBeInTheDocument();
    expect(screen.getByText('No data — the read failed')).toBeInTheDocument();

    // E o texto de ausência NÃO pode aparecer — é ele que afirmaria o que a tela não sabe.
    expect(screen.queryByText('No enforcement action recorded')).not.toBeInTheDocument();
    expect(screen.queryByText(/Nenhuma mensagem foi bloqueada ou reescrita/)).not.toBeInTheDocument();
  });

  it('quando a leitura DÁ CERTO e não há nada, afirma a ausência — e só então', async () => {
    // O par do caso acima. Sem ele, a forma fácil de passar no anterior seria nunca afirmar
    // ausência nenhuma, e a tela perderia a informação que ela existe para dar.
    mockEvents.mockResolvedValue({ events: [] });
    render(<TrustEnforcementPage />);

    expect(await screen.findByText('No enforcement action recorded')).toBeInTheDocument();
    expect(screen.queryByText('Could not load the audit trail')).not.toBeInTheDocument();
    expect(screen.queryByText('No data — the read failed')).not.toBeInTheDocument();
  });
});
